"""The Parameter list: which names mean the same parameter.

Empty list = nothing here changes anything, so a lab that has not set it up
behaves exactly as before.

A name is compared the way reference ranges always have been (trimmed,
upper-case) — not letters-and-digits-only, which would make NEUT% and NEUT#
the same thing.
"""
from models.clinical import Parameter


def norm(x) -> str:
    return (x or "").strip().upper()


def split_aliases(raw) -> list:
    """"WBC, TLC; White Blood Cells" -> ["WBC", "TLC", "White Blood Cells"]"""
    out = []
    for piece in (raw or "").replace(";", ",").replace("\n", ",").split(","):
        piece = piece.strip()
        if piece:
            out.append(piece)
    return out


def names_of(p) -> list:
    """The parameter's own name first, then its aliases."""
    return [p.name] + split_aliases(p.aliases)


def active_parameters(db) -> list:
    return db.query(Parameter).filter(Parameter.is_active.isnot(False)).all()


def alias_map(db) -> dict:
    """{NORMALISED NAME or ALIAS: NORMALISED CANONICAL NAME} for active parameters."""
    m = {}
    for p in active_parameters(db):
        canon_name = norm(p.name)
        for n in names_of(p):
            m.setdefault(norm(n), canon_name)
    return m


def canon(amap, name) -> str:
    k = norm(name)
    return amap.get(k, k)


def find_conflicts(db, name, aliases, exclude_id=None) -> list:
    """Messages for a name or alias that is repeated, or already used by another
    parameter. Two parameters sharing a name would make "which one is WBC?"
    unanswerable, so it is refused rather than guessed at."""
    mine = [n for n in [name] + split_aliases(aliases) if norm(n)]
    msgs, seen = [], set()
    for n in mine:
        if norm(n) in seen:
            msgs.append(f"'{n}' is listed twice in this parameter")
        seen.add(norm(n))
    for p in db.query(Parameter).all():
        if exclude_id is not None and p.id == exclude_id:
            continue
        theirs = {norm(n) for n in names_of(p)}
        for n in mine:
            if norm(n) in theirs:
                msgs.append(f"'{n}' is already used by parameter '{p.name}'")
    return msgs
