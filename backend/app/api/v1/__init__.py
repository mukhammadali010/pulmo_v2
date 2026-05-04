from fastapi import APIRouter

from app.api.v1 import admin, auth, examinations, files, final_diagnoses, patients

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(patients.router, prefix="/patients", tags=["patients"])
api_router.include_router(examinations.router, prefix="/examinations", tags=["examinations"])
api_router.include_router(
    final_diagnoses.router, prefix="/final-diagnoses", tags=["final-diagnoses"]
)
api_router.include_router(files.router, prefix="/files", tags=["files"])
