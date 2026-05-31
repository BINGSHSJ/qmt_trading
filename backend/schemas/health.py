from pydantic import BaseModel


class DirectoryStatus(BaseModel):
    name: str
    path: str
    exists: bool


class QmtHealthStatus(BaseModel):
    mode: str
    connected: bool
    message: str


class HealthStatus(BaseModel):
    app_name: str
    version: str
    api_status: str
    qmt: QmtHealthStatus
    directories: list[DirectoryStatus]
