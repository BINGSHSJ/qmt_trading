def normalize_account_total(
    total_asset: object,
    available_cash: object,
    frozen_cash: object,
    market_value: object,
) -> float:
    """Return the UI/business account total from the same visible components."""

    def to_number(value: object) -> float:
        try:
            return round(float(value or 0), 2)
        except (TypeError, ValueError):
            return 0.0

    raw_total = to_number(total_asset)
    derived_total = round(to_number(available_cash) + to_number(frozen_cash) + to_number(market_value), 2)
    if derived_total != 0:
        return derived_total
    return raw_total
