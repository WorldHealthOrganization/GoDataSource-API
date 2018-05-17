#define MyAppName "GoData"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "GoData"
#define MyAppURL "http://www.who.int/"
#define MyAppExeName "GoData v1.0.0"

[Setup]
AppId={{86CCB611-8A61-4652-9443-785D9416B253}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={pf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputBaseFilename={#MyAppExeName}
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
ExtraDiskSpaceRequired=968884224
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Dirs]


[Registry]

[Files]
Source: "mongodb-win32-i386-3.2.20-signed.msi"; DestDir: "{app}\dependencies"; Flags: ignoreversion
Source: "node-v8.11.1-x86.msi"; DestDir: "{app}\dependencies"; Flags: ignoreversion
Source: "go.data\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
Filename: "{app}\dependencies\mongodb-win32-i386-3.2.20-signed.msi";Parameters:"/quiet"; StatusMsg: "Installing Dependencies: MongoDB"; Flags: shellexec runascurrentuser waituntilterminated;
Filename: "{app}\dependencies\node-v8.11.1-x86.msi";Parameters:"/quiet"; StatusMsg: "Installing Dependencies: Node.JS"; Flags: shellexec runascurrentuser waituntilterminated;
Filename: "{cmd}"; Parameters: "/C cd {pf32}\MongoDB\Server\3.2\bin && mongod.exe --storageEngine ""mmapv1"" --dbpath ""{app}\data\db"" --logpath=""{app}\logs\mongo.log"" --install --serviceName GoDataDatabase --serviceDisplayName GoDataDatabase"; StatusMsg: "Setting up Database Service"; Flags: runhidden runascurrentuser waituntilterminated;
Filename: "{cmd}"; Parameters: "/C net start GoDataDatabase"; StatusMsg: "Starting Database Service"; Flags: runhidden runascurrentuser waituntilterminated;
Filename: "{cmd}"; Parameters: "/C cd {app} && set PATH=%PATH%;{pf32}\nodejs\; && npm install"; StatusMsg: "Installing package dependencies"; Flags: runhidden runascurrentuser waituntilterminated;
Filename: "{cmd}"; Parameters: "/C cd {app} && set PATH=%PATH%;{pf32}\nodejs\; && npm run init-database"; StatusMsg: "Setting up database"; Flags: runhidden runascurrentuser waituntilterminated;
Filename: "{cmd}"; Parameters: "/C cd {app} && set PATH=%PATH%;{pf32}\nodejs\; && npm start"; StatusMsg: "Starting application server"; Flags: runhidden runascurrentuser nowait;


[Icons]
