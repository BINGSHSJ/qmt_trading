from backend.core.config import settings
from backend.repositories.runtime_repository import RuntimeRepository
from backend.schemas.health import DirectoryStatus, HealthStatus, QmtHealthStatus
from backend.services.data_center.data_center_service import DataCenterService


class HealthService:
    def __init__(self) -> None:
        self.runtime_repository = RuntimeRepository()

    def get_status(self) -> HealthStatus:
        directories = [
            DirectoryStatus(name=name, path=str(path), exists=path.exists())
            for name, path in self.runtime_repository.ensure_runtime_directories().items()
        ]
        qmt_status = DataCenterService().qmt_status()
        return HealthStatus(
            app_name=settings.app_name,
            version=settings.app_version,
            api_status="ok",
            qmt=QmtHealthStatus(mode=qmt_status.mode, connected=qmt_status.connected, message=qmt_status.message),
            directories=directories,
        )
