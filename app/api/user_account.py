from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.response import ok
from app.database import get_db
from app.models.user import User
from app.schemas.api_key import ChangePasswordRequest
from app.utils.security import hash_password, verify_password

router = APIRouter(prefix="/api/user", tags=["user-account"])


@router.put("/password")
async def change_password(
    data: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")

    if data.current_password == data.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")

    user.password_hash = hash_password(data.new_password)
    await db.flush()
    return ok(message="密码修改成功")
