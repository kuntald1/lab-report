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


def display_names(db, parameters) -> list:
    """Rows the Parameter list knows are printed under the Parameter's own name,
    so the same parameter reads the same whoever sent it — an analyser, another
    analyser, or a person typing it in.

    An analyser sends two spellings, a code and a printed name ("HGB" /
    "Hemoglobin"). The printed name is tried first and the code only when the
    list does not know that name, so a name the list knows always decides and a
    code that belongs to a different parameter cannot pull the row away from it.
    A row the list knows under neither spelling is left exactly as it came."""
    rows = list(parameters or [])
    try:
        known = {}
        for p in active_parameters(db):
            for n in names_of(p):
                known.setdefault(norm(n), p.name)
        if not known:
            return parameters
        out = []
        for r in rows:
            nm = None
            for spelling in (r.get("name"), r.get("param")):
                if norm(spelling):
                    nm = known.get(norm(spelling))
                    if nm:
                        break
            out.append({**r, "name": nm} if nm and nm != r.get("name") else r)
        return out
    except Exception:
        return parameters


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


def arrange(db, parameters) -> list:
    """[(parameter dict, heading or None)] in print order.

    Order: parameters the list gives an order to come first, by that order;
    the rest keep the analyser's sequence after them. A report where no
    parameter has an order or a heading comes back untouched, so a lab that
    has not set the list up prints exactly as before."""
    rows = list(parameters or [])
    try:
        info = {}
        for p in active_parameters(db):
            info[norm(p.name)] = (p.sort_order, (p.section or "").strip() or None)
        if not any(o is not None or s for o, s in info.values()):
            return [(p, None) for p in rows]
        amap = alias_map(db)
        meta = []
        for i, p in enumerate(rows):
            # An analyser sends a code and a printed name ("HGB" / "Hemoglobin");
            # whichever of the two the list knows decides the heading and order.
            o, s = (None, None)
            for n in (p.get("name"), p.get("param")):
                if n and canon(amap, n) in info:
                    o, s = info[canon(amap, n)]
                    break
            meta.append((i, p, o, s))
        meta.sort(key=lambda m: (m[2] is None, m[2] if m[2] is not None else 0, m[0]))
        return [(p, s) for _, p, _, s in meta]
    except Exception:
        return [(p, None) for p in rows]
