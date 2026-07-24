"""
Configurable letterhead / signature / layout settings for the official
sample-report PDF (routers/pdf.py generate_combined_pdf).

Stored as Tenant.report_settings (JSON, nullable). Any key an admin hasn't
set falls back to DEFAULT_REPORT_SETTINGS, so a brand-new tenant gets a
working report immediately and an admin UI can later PATCH just the keys it
wants to change (partial update — see routers/admin.py report-settings
endpoint) without ever needing a schema migration for new fields.

layout:
    "continuous"  — all test panels flow one after another on shared pages
    "page_break"  — each test panel starts on its own page
"""

DEFAULT_REPORT_SETTINGS = {
    "layout": "continuous",   # "continuous" | "page_break"
    "lab_name": "HEALTHYCIAN",
    "tagline": "Improving Lives With a Smile",
    "unit_of": "HEALTHNODE BIOSCIENCE PVT.LTD",
    "address_lines": ["20/1/5 Bhagaban Chatterjee Lane,", "Kadamtala, Howrah- 711101."],
    "phones": ["9088801015", "9088801016", "9230997074"],
    "email": "corporatepartner.healthycian@gmail.com",
    "website": "www.healthycianhealthcare.com",
    "pathologist_name": "Dr Manas Talukdar",
    "pathologist_qualification": "MD (Pathology)",
    "registration_no": "63582",
}


def get_report_settings(tenant) -> dict:
    """Merge a tenant's report_settings JSON over the defaults. `tenant` may
    be None (e.g. patient not yet scoped to a tenant) — defaults are used."""
    merged = dict(DEFAULT_REPORT_SETTINGS)
    overrides = getattr(tenant, "report_settings", None) if tenant else None
    if overrides:
        merged.update({k: v for k, v in overrides.items() if v not in (None, "")})
    return merged
