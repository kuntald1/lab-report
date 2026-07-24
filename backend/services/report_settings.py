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

logo_filename / signature on this tenant object:
    logo_filename is just the filename (not a full path/URL) of an uploaded
    lab logo, saved under REPORT_ASSETS_DIR by routers/admin.py's upload
    endpoint. Kept as a bare filename (not a URL) so routers/pdf.py can read
    the file straight off disk — it never has to make an HTTP round-trip to
    render its own server's static files. asset_url() below builds the URL
    a frontend would use to preview the same file.
    None/absent = fall back to the built-in Healthycian logo.

    There is deliberately no tenant-level signature image anymore — a
    report's signature comes from whichever doctor actually validated it
    (ReferralDoctor.signature_filename, see routers/pdf.py
    _validating_doctor()), since one shared tenant-wide signature doesn't
    make sense once more than one pathologist can sign reports. The
    pathologist_name/qualification/registration_no fields below are kept
    only as the fallback identity used when no validating doctor can be
    resolved (e.g. a report with no BillItem link yet).
"""
import os

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
    "logo_filename": None,        # uploaded lab logo, replaces the built-in Healthycian logo when set
}

# Backend-local directory the uploaded logo/signature files live in. Mounted
# as a Docker named volume (report_assets_data) in docker-compose.yml so
# uploads survive image rebuilds, and served at /report-assets/... by
# main.py's StaticFiles mount for frontend previews.
REPORT_ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "report_assets")
os.makedirs(REPORT_ASSETS_DIR, exist_ok=True)

APP_URL = os.getenv("APP_PUBLIC_URL", "https://medicloud.mooo.com").rstrip("/")


def asset_path(filename: str) -> str:
    """Absolute filesystem path for an uploaded report-branding image."""
    return os.path.join(REPORT_ASSETS_DIR, filename)


def asset_url(filename: str) -> str:
    """Public URL for an uploaded report-branding image (frontend preview).
    Under /api/ to match main.py's mount — see the comment there for why."""
    return f"{APP_URL}/api/report-assets/{filename}"


def get_report_settings(tenant) -> dict:
    """Merge a tenant's report_settings JSON over the defaults. `tenant` may
    be None (e.g. patient not yet scoped to a tenant) — defaults are used."""
    merged = dict(DEFAULT_REPORT_SETTINGS)
    overrides = getattr(tenant, "report_settings", None) if tenant else None
    if overrides:
        merged.update({k: v for k, v in overrides.items() if v not in (None, "")})
    return merged
