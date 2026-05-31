"""QMT adapter package.

Runtime code should import concrete adapters explicitly from their modules.
Test-isolation adapters live outside this package entrypoint so the default
QMT namespace does not imply a Mock business mode.
"""

__all__: list[str] = []
