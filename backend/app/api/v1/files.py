from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.api.deps import CurrentUser
from app.services.storage import examination_file_path

router = APIRouter()


@router.get("/examinations/{filename}")
async def get_examination_file(
    filename: str,
    _: CurrentUser,  # auth required
) -> FileResponse:
    path = examination_file_path(filename)
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return FileResponse(path)
