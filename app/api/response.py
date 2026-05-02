from typing import Any

from pydantic import BaseModel


class ApiResponse(BaseModel):
    success: bool
    data: Any = None
    message: str = ""


def ok(data: Any = None, message: str = "ok") -> dict:
    return {"success": True, "data": data, "message": message}


def fail(message: str = "error", data: Any = None) -> dict:
    return {"success": False, "data": data, "message": message}
