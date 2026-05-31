from backend.schemas.common import PageQuery


def build_sort_clause(query: PageQuery, allowed_fields: dict[str, str], default_field: str, default_order: str = "desc") -> str:
    field = allowed_fields.get(query.sort_field, allowed_fields[default_field])
    order = query.sort_order.lower() if query.sort_order else default_order
    direction = "ASC" if order == "asc" else "DESC"
    return f"{field} {direction}"


def append_status_filter(clauses: list[str], params: list[object], field: str, query: PageQuery) -> None:
    if query.status:
        clauses.append(f"{field} = ?")
        params.append(query.status)


def append_date_filter(clauses: list[str], params: list[object], field: str, query: PageQuery) -> None:
    if query.start_date:
        clauses.append(f"substr({field}, 1, 10) >= ?")
        params.append(query.start_date)
    if query.end_date:
        clauses.append(f"substr({field}, 1, 10) <= ?")
        params.append(query.end_date)
