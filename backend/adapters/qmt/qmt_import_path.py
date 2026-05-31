import importlib.util
import sys
from pathlib import Path


def candidate_site_packages(qmt_path: str) -> list[Path]:
    """Return likely xtquant package roots under a QMT/MiniQMT install path."""
    if not qmt_path:
        return []
    root = Path(qmt_path).expanduser()
    candidates = [
        root,
        root / "bin.x64" / "Lib" / "site-packages",
        root / "bin.x86" / "Lib" / "site-packages",
        root / "python" / "Lib" / "site-packages",
        root / "Lib" / "site-packages",
    ]
    return [path for path in candidates if (path / "xtquant").exists()]


def ensure_xtquant_import_path(qmt_path: str) -> Path | None:
    """Add QMT bundled site-packages to sys.path when xtquant is bundled there."""
    for path in candidate_site_packages(qmt_path):
        path_text = str(path)
        if path_text not in sys.path:
            # Append instead of prepend so QMT's bundled legacy packages do not
            # shadow the backend runtime's own dependencies.
            sys.path.append(path_text)
            importlib.invalidate_caches()
        return path
    return None


def find_xtquant_spec(qmt_path: str = ""):
    ensure_xtquant_import_path(qmt_path)
    return importlib.util.find_spec("xtquant")
