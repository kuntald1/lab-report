"""Values the lab works out from other values rather than measuring.

A lipid panel is the standard case: the analyser reports total cholesterol,
triglycerides, HDL and LDL, and the report also carries VLDL and three ratios
that nobody measures — they are arithmetic on the four.

    VLDL Cholesterol = Triglycerides / 5            (mg/dL, whole number)
    Bilirubin Indirect = Total - Direct             (2 decimals)
    Globulin         = Total Protein - Albumin      (2 decimals)
    A/G Ratio        = Albumin / Globulin           (2 decimals)
    BUN              = Urea / 2.14                  (mg/dL, 2 decimals)
    CHOL/HDL RATIO   = Total Cholesterol / HDL      (2 decimals)
    LDL/HDL RATIO    = LDL / HDL                    (2 decimals)
    HDL/LDL RATIO    = HDL / LDL                    (2 decimals)

Only what the formulas need is looked at, and a row is produced only when every
input is present and numeric. A result that lacks, say, HDL simply gets no
ratios — never a made-up number.

Rows made here carry `calculated: True` and methodology "calculated" (unless
the lab's catalog names one for that parameter, which then wins). That is what lets the Calculate button
refresh them after somebody edits an input, without ever touching a value an
analyser actually measured.
"""
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation


def _key(name) -> str:
    """Comparable form of a name: letters and digits only, upper-case."""
    return "".join(ch for ch in str(name or "") if ch.isalnum()).upper()


# Every spelling an analyser or the parameter list uses for each input.
TOTAL_CHOL = {"CHOL", "CHOLESTEROL", "CHOLESTEROLTOTAL", "TOTALCHOLESTEROL", "TCHOL"}
TRIG       = {"TRIG", "TG", "TRIGLYCERIDES", "TRIGLYCERIDE"}
HDL        = {"HDL", "HDLC", "HDLCD", "HDLCHOLESTEROL", "CHOLESTEROLHDL", "CHOLESTEROLHDLDIRECT"}
LDL        = {"LDL", "LDLC", "LDLCD", "LDLCHOLESTEROL", "CHOLESTEROLLDL"}
UREA       = {"UREA", "BLOODUREA", "SERUMUREA", "UREASERUM"}
BIL_TOTAL  = {"BIT", "TBIL", "BILIRUBINTOTAL", "TOTALBILIRUBIN", "BILIRUBINTOTALSERUM"}
BIL_DIRECT = {"BIDD", "DBIL", "BILIRUBINDIRECT", "DIRECTBILIRUBIN", "BILIRUBINDIRECTSERUM"}
T_PROTEIN  = {"PRO", "TP", "TOTALPROTEIN", "PROTEINTOTAL", "TOTALPROTEINSERUM"}
ALBUMIN    = {"ALB", "ALBD", "ALBUMIN", "ALBUMINSERUM"}
GLOBULIN   = {"GLOB", "GLOBULIN", "GLOBULINSERUM"}

# name = the Parameter-list name, so the lab's reference ranges attach to the row.
# Each formula takes the dict of inputs it asked for.
FORMULAS = [
    {"name": "VLDL Cholesterol", "unit": "mg/dL", "dp": 0,
     "needs": {"tg": TRIG},
     "fn": lambda v: v["tg"] / 5,
     "names": {"VLDLCHOLESTEROL", "VLDL", "VLDLC"}},
    {"name": "CHOL/HDL RATIO", "unit": "ratio", "dp": 2,
     "needs": {"tc": TOTAL_CHOL, "hdl": HDL},
     "fn": lambda v: v["tc"] / v["hdl"],
     "names": {"CHOLHDLRATIO"}},
    {"name": "LDL/HDL RATIO", "unit": "ratio", "dp": 2,
     "needs": {"ldl": LDL, "hdl": HDL},
     "fn": lambda v: v["ldl"] / v["hdl"],
     "names": {"LDLHDLRATIO"}},
    {"name": "HDL/LDL RATIO", "unit": "ratio", "dp": 2,
     "needs": {"hdl": HDL, "ldl": LDL},
     "fn": lambda v: v["hdl"] / v["ldl"],
     "names": {"HDLLDLRATIO"}},
    # Liver panel: three more figures nobody measures. Globulin must come before
    # A/G Ratio so the ratio can use it in the same pass.
    {"name": "Bilirubin Indirect", "unit": "mg/dL", "dp": 2,
     "needs": {"t": BIL_TOTAL, "d": BIL_DIRECT},
     "fn": lambda v: v["t"] - v["d"],
     "names": {"BILIRUBININDIRECT", "INDIRECTBILIRUBIN", "IBIL", "BILIRUBININDIRECTSERUM"}},
    {"name": "Globulin", "unit": "g/dL", "dp": 2,
     "needs": {"tp": T_PROTEIN, "alb": ALBUMIN},
     "fn": lambda v: v["tp"] - v["alb"],
     "names": {"GLOBULIN", "GLOB", "GLOBULINSERUM"}},
    {"name": "A/G Ratio", "unit": "ratio", "dp": 2,
     "needs": {"alb": ALBUMIN, "glob": GLOBULIN},
     "fn": lambda v: v["alb"] / v["glob"],
     "names": {"AGRATIO", "ALBUMINGLOBULINRATIO", "AG"}},
    # Blood urea nitrogen is the nitrogen share of urea (60 g urea holds 28 g N,
    # i.e. 1 / 2.14). 36 mg/dL urea -> 16.82, the figure CrelioHealth prints.
    {"name": "BUN", "unit": "mg/dL", "dp": 2,
     "needs": {"urea": UREA},
     "fn": lambda v: v["urea"] / Decimal("2.14"),
     "names": {"BUN", "BLOODUREANITROGEN", "UREANITROGEN"}},
]


def _number(value):
    """A value as Decimal, or None when it isn't a plain number ('<5', '', None)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        d = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() else None


def _round(d: Decimal, dp: int):
    """Half-up, the way a person rounds: 34.5 -> 35 (Python's round() gives 34)."""
    q = Decimal(1).scaleb(-dp)
    r = d.quantize(q, rounding=ROUND_HALF_UP)
    return int(r) if dp == 0 else float(r)


def _find(parameters, spellings):
    """The first parameter whose code or printed name is one of `spellings`, as a
    number — or None."""
    for p in parameters:
        if _key(p.get("param")) in spellings or _key(p.get("name")) in spellings:
            n = _number(p.get("value"))
            if n is not None:
                return n
    return None


def _is_row_of(p, formula) -> bool:
    return _key(p.get("param")) in formula["names"] or _key(p.get("name")) in formula["names"] \
        or _key(p.get("name")) == _key(formula["name"])


def add_calculated(parameters, overwrite: bool = False):
    """The parameters plus any calculated rows the inputs allow.

    overwrite=False (reading a result, building a PDF): a row that already
    exists — whether stored earlier or typed by hand — is left exactly as it is,
    so what is printed is what was saved. Only missing rows are added.

    overwrite=True (the Calculate button): rows this module made before
    (`calculated: True`) are recomputed from the current inputs. A row that came
    from the analyser, or was never marked calculated, is still left alone.

    Returns the same list object when nothing changed.
    """
    if not parameters:
        return parameters or []

    out, changed = list(parameters), False
    for f in FORMULAS:
        inputs = {k: _find(out, spell) for k, spell in f["needs"].items()}
        existing = next((i for i, p in enumerate(out) if _is_row_of(p, f)), None)

        value = None
        if all(v is not None for v in inputs.values()):
            try:
                value = _round(Decimal(f["fn"](inputs)), f["dp"])
            except (ZeroDivisionError, InvalidOperation):
                value = None                    # HDL or LDL of zero: no ratio

        if existing is None:
            if value is None:
                continue
            out.append({"param": f["name"], "name": f["name"], "value": value,
                        "unit": f["unit"], "ref_min": "", "ref_max": "",
                        "flag": "N", "status": "Normal", "calculated": True,
                        "method": "calculated"})
            changed = True
            continue
        if out[existing].get("calculated") and not out[existing].get("method"):
            # A calculated row saved from the edit screen comes back without its
            # methodology (the edit form doesn't carry it), so put it back.
            out[existing] = {**out[existing], "method": "calculated"}
            changed = True
        if overwrite and out[existing].get("calculated"):
            row = dict(out[existing])
            if value is None:
                # An input was removed or became non-numeric: drop the stale row
                # rather than leave a number that no longer follows from anything.
                out.pop(existing)
                changed = True
                continue
            if row.get("value") != value:
                row["value"] = value
                row.pop("flag_manual", None)     # new number, so the old judgement no longer applies
                out[existing] = row
                changed = True
    return out if changed else parameters
