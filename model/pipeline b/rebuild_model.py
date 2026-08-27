from __future__ import annotations

import argparse
import json
from pathlib import Path

from csrs_model import rebuild_model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild the corrected CSRS behavioural, geographic, and firmographic model."
    )
    parser.add_argument(
        "--model-directory",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Directory containing the online retail workbook and model database.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    summary = rebuild_model(args.model_directory)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
