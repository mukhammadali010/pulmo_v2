from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp", "application/dicom"}
ALLOWED_AUDIO_MIME = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
}
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB

STORAGE_ROOT = Path(__file__).resolve().parent.parent.parent / "storage"
EXAMINATION_DIR = STORAGE_ROOT / "examinations"
EXAMINATION_DIR.mkdir(parents=True, exist_ok=True)


class StorageError(Exception):
    """Raised on validation or IO failures during upload."""


async def save_examination_file(
    file: UploadFile, *, allowed: set[str]
) -> tuple[str, str, int]:
    """Persist an upload to disk and return (filename, mime, size_bytes)."""
    if file.content_type not in allowed:
        raise StorageError(f"Unsupported file type: {file.content_type}")

    suffix = _suffix_for_mime(file.content_type)
    filename = f"{uuid4().hex}{suffix}"
    target = EXAMINATION_DIR / filename

    size = 0
    with target.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                out.close()
                target.unlink(missing_ok=True)
                raise StorageError(f"File exceeds {MAX_FILE_BYTES // (1024 * 1024)} MB limit")
            out.write(chunk)

    return filename, file.content_type or "application/octet-stream", size


def examination_file_path(filename: str) -> Path | None:
    candidate = (EXAMINATION_DIR / filename).resolve()
    if EXAMINATION_DIR.resolve() not in candidate.parents:
        return None  # path traversal guard
    return candidate if candidate.is_file() else None


def _suffix_for_mime(mime: str | None) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "application/dicom": ".dcm",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".m4a",
        "audio/m4a": ".m4a",
        "audio/x-m4a": ".m4a",
    }.get(mime or "", "")
