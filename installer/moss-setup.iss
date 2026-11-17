; ============================================================
; MOSS CORE 安装包脚本
; 编译：ISCC.exe moss-setup.iss
; ============================================================

#define MyAppName "MOSS CORE"
#define MyAppNameZh "MOSS CORE 异动监测"
#define MyAppVersion "1.0.55"
#define MyAppPublisher "550C"
#define MyAppExeName "MOSS CORE.exe"
#define SourceDir "D:\MOSS\installer\payload"

[Setup]
AppId={{8F3C1B42-5A7D-4E19-9C2B-77E1A5D0C934}
AppName={#MyAppNameZh}
AppVersion={#MyAppVersion}
AppVerName={#MyAppNameZh} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={sd}\MOSS CORE
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=no
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=MOSS-CORE-Setup-v{#MyAppVersion}
SetupIconFile={#SourceDir}\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppNameZh}
VersionInfoVersion={#MyAppVersion}
VersionInfoDescription={#MyAppNameZh} 安装程序
VersionInfoCompany={#MyAppPublisher}
VersionInfoProductName={#MyAppName}

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "zh"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
Source: "{#SourceDir}\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\index.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\data-source.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#SourceDir}\live-seed.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#SourceDir}\window-default.txt"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#SourceDir}\README.txt"; DestDir: "{app}"; Flags: ignoreversion isreadme skipifsourcedoesntexist
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#SourceDir}\VERSION.txt"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; 用户配置：已存在则不覆盖
Source: "{#SourceDir}\watchlist.json"; DestDir: "{app}"; Flags: onlyifdoesntexist uninsneveruninstall skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppNameZh}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppNameZh}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppNameZh}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: files; Name: "{app}\boot.log"
Type: files; Name: "{app}\install-path.txt"
