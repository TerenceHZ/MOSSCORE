# -*- coding: utf-8 -*-
"""生成 dev / release 两个安装包（含各自 payload 与 iss）"""
import io, os, re, shutil, subprocess

ROOT = r"D:\MOSS"
VER = "1.0.61"
ISCC = r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
DOTNET = r"C:\Users\ROG\.dotnet\dotnet.exe"
SRC = os.path.join(ROOT, "desktop-webview")
TPL = os.path.join(ROOT, "installer", "moss-setup.iss")


def sh(cmd):
    print(">>", " ".join(cmd))
    subprocess.run(cmd, check=False)


def build(channel, setup_name, appver):
    payload = os.path.join(ROOT, "installer", "payload-" + channel)
    if os.path.isdir(payload):
        shutil.rmtree(payload)
    os.makedirs(payload)

    publish = os.path.join(ROOT, "release", channel)
    if os.path.isdir(publish):
        shutil.rmtree(publish)
    cmd = [DOTNET, "publish", os.path.join(SRC, "MossCore.csproj"), "-c", "Release",
           "-r", "win-x64", "--self-contained", "true", "-o", publish, "--nologo", "-v", "q"]
    if channel == "release":
        cmd += ["-p:Channel=release"]
    sh(cmd)

    shutil.copy(os.path.join(publish, "MOSS CORE.exe"), os.path.join(payload, "MOSS CORE.exe"))
    shutil.copy(os.path.join(SRC, "index.html"), os.path.join(payload, "index.html"))
    for f in ("icon.ico", "data-source.json", "live-seed.json", "watchlist.json", "window-default.txt"):
        for base in (SRC, os.path.join(os.environ["USERPROFILE"], "MOSS CORE")):
            src = os.path.join(base, f)
            if os.path.exists(src):
                shutil.copy(src, os.path.join(payload, f))
                break

    io.open(os.path.join(payload, "VERSION.txt"), "w", encoding="utf-8").write(
        "MOSS CORE %s · %s · 2026-11-19\n" % (appver, channel))

    iss = io.open(TPL, encoding="utf-8-sig").read()
    iss = re.sub(r'#define MyAppVersion "[^"]*"', '#define MyAppVersion "%s"' % appver, iss)
    iss = re.sub(r'#define SourceDir "[^"]*"', lambda m: '#define SourceDir "%s"' % payload, iss)
    iss = re.sub(r'OutputBaseFilename=.*', 'OutputBaseFilename=%s' % setup_name, iss)
    # 版本资源必须是纯数字（dev 后缀只能出现在文件名/显示名里）
    iss = re.sub(r'VersionInfoVersion=.*', 'VersionInfoVersion=%s' % VER, iss)
    iss = re.sub(r'OutputDir=.*', lambda m: 'OutputDir=%s' % os.path.join(ROOT, 'installer', 'dist'), iss)

    iss_path = os.path.join(ROOT, "installer", "dist", "build-%s.iss" % channel)
    os.makedirs(os.path.dirname(iss_path), exist_ok=True)
    io.open(iss_path, "w", encoding="utf-8").write(iss)
    sh([ISCC, iss_path])
    out = os.path.join(ROOT, "installer", "dist", setup_name + ".exe")
    return out


dev_setup = build("dev", "MOSS-CORE-Setup-v%s-dev" % VER, VER + "-dev")
rel_setup = build("release", "MOSS-CORE-Setup-v%s" % VER, VER)
for p in (dev_setup, rel_setup):
    if os.path.exists(p):
        print("OK  ", os.path.basename(p), round(os.path.getsize(p) / 1048576, 1), "MB")
    else:
        print("MISS", p)
