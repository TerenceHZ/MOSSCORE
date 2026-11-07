#!/usr/bin/env python3
import argparse
import json
import license_core


def main():
    p = argparse.ArgumentParser(description="MOSS CORE invite-code admin")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create")
    c.add_argument("--days", type=int, default=365)
    c.add_argument("--devices", type=int, default=1)
    l = sub.add_parser("list")
    r = sub.add_parser("reset")
    r.add_argument("code")
    a = p.parse_args()
    if a.cmd == "create":
        code = license_core.create_code(a.devices, a.days)
        print(code)
        print(f"devices={a.devices} days={a.days}")
    elif a.cmd == "list":
        print(json.dumps(license_core.list_codes(), ensure_ascii=False, indent=2))
    elif a.cmd == "reset":
        print("reset ok" if license_core.reset_code(a.code) else "code not found")


if __name__ == "__main__":
    main()
