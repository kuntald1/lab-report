"""
Creates result_attachments — files (PDF/image reports from an external lab)
attached to an outsourced lab_results row. Additive + idempotent.

    python -m scripts.init_result_attachments
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, Base
from models import models, org, clinical, billing, commission, b2b   # noqa: F401


def main():
    print("Ensuring tables (creates result_attachments if missing) ...")
    Base.metadata.create_all(bind=engine)
    print("Done.")


if __name__ == "__main__":
    main()
