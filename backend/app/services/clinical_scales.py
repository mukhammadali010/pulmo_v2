"""Deterministic clinical scoring calculators (CRB-65, CAT, GINA, mMRC, GOLD).

These are pure functions — no AI, no I/O. Each returns a structured result so
the frontend can render score, severity, and a human-readable recommendation
without re-implementing the rules client-side.

Scale references are kept on the result so the UI can cite the source to the
physician (every clinician asks "where does this come from?").
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, TypedDict


class ScaleType(StrEnum):
    CRB_65 = "crb_65"
    CAT = "cat"
    GINA_SEVERITY = "gina_severity"
    MMRC = "mmrc"
    GOLD_STAGE = "gold_stage"


class Severity(StrEnum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


class ScaleResult(TypedDict):
    """The shape persisted in `Examination.parameters` and returned to the client.

    Keys are camelCase because this dict is serialized verbatim into the
    Examination's `parameters` JSONB column — it does NOT pass through Pydantic's
    alias_generator. The frontend reads it as-is.
    """

    scaleType: str
    inputs: dict[str, Any]
    score: int
    scoreMax: int
    severity: str
    severityLabel: str  # short clinical phrase, e.g. "O'rta xavf"
    recommendation: str  # one-sentence next-step in the prompt language
    breakdown: list[dict[str, Any]]  # per-criterion contribution (label, value, points)
    reference: str  # citation, e.g. "Lim WS et al., Thorax 2003;58:377-382"


# ---- CRB-65 -----------------------------------------------------------------

CRB65_REFERENCE = "Lim WS et al., Thorax 2003;58:377-382"
CRB65_MAX_SCORE = 4


def calculate_crb65(
    *,
    confusion: bool,
    respiratory_rate: float | None,
    systolic_bp: float | None,
    diastolic_bp: float | None,
    age: int | None,
) -> ScaleResult:
    """CRB-65: community-acquired pneumonia severity / 30-day mortality risk.

    One point each for: Confusion, Respiratory rate >=30/min, Blood pressure
    (systolic <90 OR diastolic <=60 mmHg), Age >=65. Total 0-4.

    Inputs are accepted as nullable so the frontend can let the doctor leave a
    field blank when it wasn't measured — we treat unknowns as "0 points" but
    flag them in the breakdown so the doctor sees what was missing.
    """
    breakdown: list[dict[str, Any]] = []

    c_points = 1 if confusion else 0
    breakdown.append(
        {
            "key": "confusion",
            "labelEn": "Confusion (new disorientation / AMTS ≤8)",
            "value": confusion,
            "points": c_points,
            "missing": False,
        }
    )

    r_points = 0
    r_missing = respiratory_rate is None
    if respiratory_rate is not None and respiratory_rate >= 30:
        r_points = 1
    breakdown.append(
        {
            "key": "respiratory_rate",
            "labelEn": "Respiratory rate ≥30/min",
            "value": respiratory_rate,
            "points": r_points,
            "missing": r_missing,
            "threshold": "≥30/min",
        }
    )

    b_points = 0
    b_missing = systolic_bp is None and diastolic_bp is None
    if (systolic_bp is not None and systolic_bp < 90) or (
        diastolic_bp is not None and diastolic_bp <= 60
    ):
        b_points = 1
    breakdown.append(
        {
            "key": "blood_pressure",
            "labelEn": "Systolic <90 mmHg or diastolic ≤60 mmHg",
            "value": {"systolic": systolic_bp, "diastolic": diastolic_bp},
            "points": b_points,
            "missing": b_missing,
        }
    )

    age_points = 0
    age_missing = age is None
    if age is not None and age >= 65:
        age_points = 1
    breakdown.append(
        {
            "key": "age",
            "labelEn": "Age ≥65 years",
            "value": age,
            "points": age_points,
            "missing": age_missing,
        }
    )

    score = c_points + r_points + b_points + age_points

    if score == 0:
        severity = Severity.LOW
        severity_label = "Past xavf"
        recommendation = (
            "Uy sharoitida davolanish mumkin (past o'lim xavfi). "
            "Klinik holatni baholash va antibakterial terapiyani tayinlash."
        )
    elif score <= 2:
        severity = Severity.MODERATE
        severity_label = "O'rtacha xavf"
        recommendation = (
            "Statsionar davolanishni ko'rib chiqish tavsiya etiladi yoki "
            "qisqa muddatli kuzatuv bilan ambulator davolanish."
        )
    else:
        severity = Severity.HIGH
        severity_label = "Yuqori xavf"
        recommendation = (
            "Shoshilinch statsionar davolanish, ICU mulohazasi. "
            "Yuqori 30-kunlik o'lim xavfi."
        )

    return ScaleResult(
        scaleType=ScaleType.CRB_65.value,
        inputs={
            "confusion": confusion,
            "respiratoryRate": respiratory_rate,
            "systolicBp": systolic_bp,
            "diastolicBp": diastolic_bp,
            "age": age,
        },
        score=score,
        scoreMax=CRB65_MAX_SCORE,
        severity=severity.value,
        severityLabel=severity_label,
        recommendation=recommendation,
        breakdown=breakdown,
        reference=CRB65_REFERENCE,
    )


# ---- CAT (COPD Assessment Test) --------------------------------------------

CAT_REFERENCE = "Jones PW et al., Eur Respir J 2009;34:648-654"
CAT_MAX_SCORE = 40

CAT_QUESTIONS = (
    "cough",
    "phlegm",
    "chestTightness",
    "breathlessness",
    "activityLimitation",
    "confidence",
    "sleep",
    "energy",
)


def calculate_cat(*, answers: dict[str, int | None]) -> ScaleResult:
    """CAT: 8 patient-reported items, each 0-5, summed (0-40).

    A higher score indicates greater COPD impact on health status.
    Per Jones 2009: <10 low, 10-20 medium, 21-30 high, >30 very high.
    """
    breakdown: list[dict[str, Any]] = []
    score = 0
    for key in CAT_QUESTIONS:
        v = answers.get(key)
        v_int: int | None = None
        if v is not None:
            try:
                v_int = max(0, min(5, int(v)))
            except (TypeError, ValueError):
                v_int = None
        points = v_int if v_int is not None else 0
        score += points
        breakdown.append(
            {
                "key": key,
                "labelEn": f"CAT item: {key}",
                "value": v_int,
                "points": points,
                "missing": v_int is None,
            }
        )

    if score < 10:
        severity = Severity.LOW
        severity_label = "Past ta'sir"
        recommendation = (
            "COPD hayot sifatiga past ta'sir. Joriy davolanish va profilaktikani davom ettirish."
        )
    elif score <= 20:
        severity = Severity.MODERATE
        severity_label = "O'rtacha ta'sir"
        recommendation = (
            "O'rtacha ta'sir. Davolanishni optimallashtirish, inhaler texnikasini tekshirish, "
            "o'pka reabilitatsiyasini ko'rib chiqish."
        )
    elif score <= 30:
        severity = Severity.HIGH
        severity_label = "Yuqori ta'sir"
        recommendation = (
            "Hayot sifatiga jiddiy ta'sir. Davolanishni kuchaytirish, reabilitatsiya, "
            "ko'shimcha klinik baholash."
        )
    else:
        severity = Severity.HIGH
        severity_label = "Juda yuqori ta'sir"
        recommendation = (
            "Hayot sifatiga juda jiddiy ta'sir. Specialist konsultatsiyasi va davolanishni "
            "to'liq qayta ko'rib chiqish."
        )

    return ScaleResult(
        scaleType=ScaleType.CAT.value,
        inputs={k: answers.get(k) for k in CAT_QUESTIONS},
        score=score,
        scoreMax=CAT_MAX_SCORE,
        severity=severity.value,
        severityLabel=severity_label,
        recommendation=recommendation,
        breakdown=breakdown,
        reference=CAT_REFERENCE,
    )


# ---- GINA Severity (asthma exacerbation, GINA 2009 table) -------------------

GINA_REFERENCE = "GINA Global Strategy for Asthma Management and Prevention, 2009"
GINA_MAX_SCORE = 3  # 1 = mild, 2 = moderate, 3 = severe


def _gina_classify_pulse(pulse: float | None) -> int:
    if pulse is None:
        return 0
    if pulse > 120:
        return 3
    if pulse >= 100:
        return 2
    return 1


def _gina_classify_pef(pef_pct: float | None) -> int:
    if pef_pct is None:
        return 0
    if pef_pct < 60:
        return 3
    if pef_pct <= 80:
        return 2
    return 1


def _gina_classify_sao2(sao2: float | None) -> int:
    if sao2 is None:
        return 0
    if sao2 < 90:
        return 3
    if sao2 <= 95:
        return 2
    return 1


def _gina_classify_rr(rr: float | None) -> int:
    if rr is None:
        return 0
    if rr > 30:
        return 3
    return 1  # any "increased" RR without exact threshold ≈ mild/moderate


def calculate_gina_severity(
    *,
    pulse: float | None,
    pef_pct: float | None,
    sao2: float | None,
    respiratory_rate: float | None,
) -> ScaleResult:
    """GINA 2009 asthma exacerbation severity — worst-of-all classification.

    The score is the highest (most severe) classification among the 4 supplied
    parameters. Missing parameters don't penalize.
    """
    p_pulse = _gina_classify_pulse(pulse)
    p_pef = _gina_classify_pef(pef_pct)
    p_sao2 = _gina_classify_sao2(sao2)
    p_rr = _gina_classify_rr(respiratory_rate)
    classifications = [p_pulse, p_pef, p_sao2, p_rr]
    score = max(classifications) if any(classifications) else 0

    breakdown = [
        {
            "key": "pulse",
            "labelEn": "Pulse: <100 mild, 100-120 moderate, >120 severe",
            "value": pulse,
            "points": p_pulse,
            "missing": pulse is None,
        },
        {
            "key": "pef_pct",
            "labelEn": "PEF (% personal best): >80 mild, 60-80 moderate, <60 severe",
            "value": pef_pct,
            "points": p_pef,
            "missing": pef_pct is None,
        },
        {
            "key": "sao2",
            "labelEn": "SaO2: >95 mild, 91-95 moderate, <90 severe",
            "value": sao2,
            "points": p_sao2,
            "missing": sao2 is None,
        },
        {
            "key": "respiratory_rate",
            "labelEn": "Respiratory rate: increased mild/moderate, >30 severe",
            "value": respiratory_rate,
            "points": p_rr,
            "missing": respiratory_rate is None,
        },
    ]

    if score == 0:
        severity = Severity.LOW
        severity_label = "Aniqlanmagan"
        recommendation = (
            "Tasniflash uchun parametrlar yetarli emas. Iltimos kamida pulse, PEF yoki SaO2 ni kiriting."
        )
    elif score == 1:
        severity = Severity.LOW
        severity_label = "Engil hujum"
        recommendation = (
            "Engil BA hujumi. Qisqa muddatli β2-agonist (SABA), oral steroidlar (agar javob bermasa). "
            "PEF va simptomlarni qayta baholash 60 daqiqada."
        )
    elif score == 2:
        severity = Severity.MODERATE
        severity_label = "O'rta hujum"
        recommendation = (
            "O'rta og'irlikdagi hujum. SABA + ipratropium nebulizer, oral/IV kortikosteroid, "
            "kislorod (SaO2 < 92% bo'lsa). Statsionar kuzatuv tavsiya etiladi."
        )
    else:
        severity = Severity.HIGH
        severity_label = "Og'ir hujum"
        recommendation = (
            "Og'ir BA hujumi — shoshilinch davolanish. SABA + ipratropium + tizimli steroid, "
            "kislorod, ICU mulohazasi. Hayotga xavfli holat bo'lishi mumkin."
        )

    return ScaleResult(
        scaleType=ScaleType.GINA_SEVERITY.value,
        inputs={
            "pulse": pulse,
            "pefPct": pef_pct,
            "sao2": sao2,
            "respiratoryRate": respiratory_rate,
        },
        score=score,
        scoreMax=GINA_MAX_SCORE,
        severity=severity.value,
        severityLabel=severity_label,
        recommendation=recommendation,
        breakdown=breakdown,
        reference=GINA_REFERENCE,
    )


# ---- mMRC Dyspnea Scale -----------------------------------------------------

MMRC_REFERENCE = "Modified Medical Research Council, Fletcher CM 1959"
MMRC_MAX_SCORE = 4


def calculate_mmrc(*, grade: int | None) -> ScaleResult:
    """mMRC dyspnea: doctor selects the single grade 0-4 that best matches the patient.

    The grade IS the score. Higher = worse functional impact from dyspnea.
    """
    g = grade if grade is not None and 0 <= grade <= 4 else 0
    descriptions = {
        0: "Faqat og'ir jismoniy yuk paytida hansirash",
        1: "Tez yurishda yoki balandlikka chiqishda hansirash",
        2: "Tengdoshlardan sekinroq yurish, yoki tinch yurishda nafas olish uchun to'xtash",
        3: "100 m yurgandan keyin yoki bir necha daqiqada to'xtash",
        4: "Uydan chiqa olmaslik yoki kiyim kiyishda hansirash",
    }
    breakdown = [
        {
            "key": f"grade_{i}",
            "labelEn": f"Grade {i}: {descriptions[i]}",
            "value": (i == g),
            "points": i if i == g else 0,
            "missing": grade is None,
        }
        for i in range(5)
    ]

    if g == 0:
        severity = Severity.LOW
        severity_label = "Yengil"
        recommendation = "Funksional cheklov yo'q yoki minimal. Standart kuzatuv."
    elif g == 1:
        severity = Severity.LOW
        severity_label = "Yengil"
        recommendation = "Yengil funksional cheklov. Faollikni rag'batlantirish, jismoniy mashqlar."
    elif g == 2:
        severity = Severity.MODERATE
        severity_label = "O'rtacha"
        recommendation = (
            "O'rtacha cheklov. O'pka reabilitatsiyasi, davolanishni optimallashtirish."
        )
    elif g == 3:
        severity = Severity.HIGH
        severity_label = "Og'ir"
        recommendation = (
            "Sezilarli funksional cheklov. O'pka reabilitatsiyasi tavsiya etiladi, "
            "qo'shimcha kasalliklarni baholash."
        )
    else:
        severity = Severity.HIGH
        severity_label = "Juda og'ir"
        recommendation = (
            "Hayotni jiddiy cheklaydigan hansirash. Maksimal davolanish, kislorod terapiyasini "
            "ko'rib chiqish, palliativ yondashuvni mulohaza qilish."
        )

    return ScaleResult(
        scaleType=ScaleType.MMRC.value,
        inputs={"grade": grade},
        score=g,
        scoreMax=MMRC_MAX_SCORE,
        severity=severity.value,
        severityLabel=severity_label,
        recommendation=recommendation,
        breakdown=breakdown,
        reference=MMRC_REFERENCE,
    )


# ---- GOLD COPD Stage --------------------------------------------------------

GOLD_REFERENCE = "GOLD 2024 Report — Global Strategy for Diagnosis, Management and Prevention of COPD"
GOLD_MAX_SCORE = 4


def calculate_gold_stage(
    *, fev1_pct_predicted: float | None, fev1_fvc_ratio: float | None
) -> ScaleResult:
    """GOLD COPD spirometric stage.

    Requires post-bronchodilator FEV1/FVC < 0.70 (informative — frontend can warn
    if not satisfied). Stage is derived from FEV1 % predicted:
      GOLD 1 ≥80%, GOLD 2 50-79%, GOLD 3 30-49%, GOLD 4 <30%.
    """
    if fev1_pct_predicted is None:
        stage = 0
    elif fev1_pct_predicted >= 80:
        stage = 1
    elif fev1_pct_predicted >= 50:
        stage = 2
    elif fev1_pct_predicted >= 30:
        stage = 3
    else:
        stage = 4

    copd_confirmed = fev1_fvc_ratio is not None and fev1_fvc_ratio < 0.70
    breakdown = [
        {
            "key": "fev1_pct_predicted",
            "labelEn": "FEV1 % predicted (post-bronchodilator)",
            "value": fev1_pct_predicted,
            "points": stage,
            "missing": fev1_pct_predicted is None,
        },
        {
            "key": "fev1_fvc_ratio",
            "labelEn": "FEV1/FVC ratio (must be <0.70 for COPD)",
            "value": fev1_fvc_ratio,
            "points": 0,
            "missing": fev1_fvc_ratio is None,
            "threshold": "<0.70",
        },
    ]

    if stage == 0:
        severity = Severity.LOW
        severity_label = "Aniqlanmagan"
        recommendation = "Bosqichni aniqlash uchun FEV1 % predicted kerak."
    elif stage == 1:
        severity = Severity.LOW
        severity_label = "GOLD 1 — Yengil"
        recommendation = (
            "Yengil COPD (FEV1 ≥80%). Chekishni to'xtatish, vaktsinatsiya, "
            "qisqa muddatli bronxodilator zarurat bo'yicha."
        )
    elif stage == 2:
        severity = Severity.MODERATE
        severity_label = "GOLD 2 — O'rtacha"
        recommendation = (
            "O'rtacha COPD (50-79%). Uzoq muddatli bronxodilator (LABA/LAMA), "
            "o'pka reabilitatsiyasi tavsiya etiladi."
        )
    elif stage == 3:
        severity = Severity.HIGH
        severity_label = "GOLD 3 — Og'ir"
        recommendation = (
            "Og'ir COPD (30-49%). LABA + LAMA (± ICS hujumlar bo'lsa), reabilitatsiya, "
            "exacerbation profilaktikasi."
        )
    else:
        severity = Severity.HIGH
        severity_label = "GOLD 4 — Juda og'ir"
        recommendation = (
            "Juda og'ir COPD (<30%). Kislorod terapiyasini ko'rib chiqish, multidistsiplinar "
            "yondashuv, palliativ yondashuvni mulohaza qilish."
        )

    if not copd_confirmed and fev1_fvc_ratio is not None:
        recommendation = (
            f"DIQQAT: FEV1/FVC = {fev1_fvc_ratio:.2f} ≥ 0.70 — bu COPD diagnozini "
            "tasdiqlamaydi. GOLD bosqichi faqat post-bronxodilator FEV1/FVC < 0.70 "
            "bo'lganda qo'llaniladi.\n\n" + recommendation
        )

    return ScaleResult(
        scaleType=ScaleType.GOLD_STAGE.value,
        inputs={
            "fev1PctPredicted": fev1_pct_predicted,
            "fev1FvcRatio": fev1_fvc_ratio,
        },
        score=stage,
        scoreMax=GOLD_MAX_SCORE,
        severity=severity.value,
        severityLabel=severity_label,
        recommendation=recommendation,
        breakdown=breakdown,
        reference=GOLD_REFERENCE,
    )


# ---- Dispatcher -------------------------------------------------------------

def calculate(scale_type: str, inputs: dict[str, Any]) -> ScaleResult:
    """Dispatch to the scale-specific calculator. Raises ValueError on unknowns.

    Inputs come from the frontend in camelCase (e.g. `respiratoryRate`).
    """
    if scale_type == ScaleType.CRB_65.value:
        return calculate_crb65(
            confusion=bool(inputs.get("confusion", False)),
            respiratory_rate=_as_float(inputs.get("respiratoryRate")),
            systolic_bp=_as_float(inputs.get("systolicBp")),
            diastolic_bp=_as_float(inputs.get("diastolicBp")),
            age=_as_int(inputs.get("age")),
        )
    if scale_type == ScaleType.CAT.value:
        return calculate_cat(
            answers={k: _as_int(inputs.get(k)) for k in CAT_QUESTIONS},
        )
    if scale_type == ScaleType.GINA_SEVERITY.value:
        return calculate_gina_severity(
            pulse=_as_float(inputs.get("pulse")),
            pef_pct=_as_float(inputs.get("pefPct")),
            sao2=_as_float(inputs.get("sao2")),
            respiratory_rate=_as_float(inputs.get("respiratoryRate")),
        )
    if scale_type == ScaleType.MMRC.value:
        return calculate_mmrc(grade=_as_int(inputs.get("grade")))
    if scale_type == ScaleType.GOLD_STAGE.value:
        return calculate_gold_stage(
            fev1_pct_predicted=_as_float(inputs.get("fev1PctPredicted")),
            fev1_fvc_ratio=_as_float(inputs.get("fev1FvcRatio")),
        )
    raise ValueError(f"Unsupported scale_type: {scale_type}")


def _as_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _as_int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
