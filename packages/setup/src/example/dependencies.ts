import { SDK } from "../constants.js";
import type { DetectedApp } from "../detect/platform.js";

export interface DependencyEdit {
  /** Relative to the app dir. */
  file: string;
  /** Exact line(s) Clayver inserts; `clayver remove` deletes them again. */
  lines: string[];
  apply(text: string): string | undefined;
}

/** Inserts `lines` right after the first line matching `anchor`. */
export function insertAfter(text: string, anchor: RegExp, lines: string[]): string | undefined {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const all = text.split(/\r?\n/);
  const idx = all.findIndex((l) => anchor.test(l));
  if (idx < 0) return undefined;
  all.splice(idx + 1, 0, ...lines);
  return all.join(eol);
}

/** Removes the first occurrence of each exact line. */
export function removeLines(text: string, lines: string[]): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const all = text.split(/\r?\n/);
  for (const line of lines) {
    const idx = all.indexOf(line);
    if (idx >= 0) all.splice(idx, 1);
  }
  return all.join(eol);
}

export function pubspecEdit(): DependencyEdit {
  const line = `  ${SDK.flutter.package}: ${SDK.flutter.version}`;
  return {
    file: "pubspec.yaml",
    lines: [line],
    apply(text) {
      if (new RegExp(`^\\s+${SDK.flutter.package}:`, "m").test(text)) return undefined;
      return insertAfter(text, /^dependencies:\s*$/, [line]);
    },
  };
}

export function gradleEdit(buildFile: string, kotlinDsl: boolean): DependencyEdit {
  const coord = `${SDK.android.coordinates}:${SDK.android.version}`;
  const line = kotlinDsl ? `    implementation("${coord}")` : `    implementation '${coord}'`;
  return {
    file: buildFile,
    lines: [line],
    apply(text) {
      if (text.includes(SDK.android.coordinates)) return undefined;
      return insertAfter(text, /^dependencies\s*\{\s*$/, [line]);
    },
  };
}

export function podfileEdit(podfile: string): DependencyEdit {
  const line = `  pod '${SDK.ios.podName}', '${SDK.ios.podVersion}'`;
  return {
    file: podfile,
    lines: [line],
    apply(text) {
      if (text.includes(`'${SDK.ios.podName}'`) || text.includes(`"${SDK.ios.podName}"`)) return undefined;
      return insertAfter(text, /^\s*target\s+['"][^'"]+['"]\s+do\s*$/, [line]);
    },
  };
}

/** The edit Clayver can offer, if any (SPM-only Xcode projects get instructions). */
export function dependencyEditFor(app: DetectedApp): DependencyEdit | undefined {
  switch (app.platform) {
    case "flutter":
      return pubspecEdit();
    case "android":
      return app.android ? gradleEdit(app.android.buildFile, app.android.kotlinDsl) : undefined;
    case "ios":
      return app.ios?.podfile ? podfileEdit(app.ios.podfile) : undefined;
  }
}

export function dependencyInstructions(app: DetectedApp): string[] {
  switch (app.platform) {
    case "ios":
      return [
        "Swift Package Manager (Xcode > File > Add Package Dependencies…):",
        `  ${SDK.ios.spmUrl}  → product "${SDK.ios.spmProduct}" (also add FirebaseAuth and FirebaseMessaging from firebase-ios-sdk)`,
        "CocoaPods (Podfile, inside your app target):",
        `  pod '${SDK.ios.podName}', '${SDK.ios.podVersion}'   then: pod install`,
      ];
    case "android":
      return [
        `${app.android?.buildFile ?? "app/build.gradle.kts"}:`,
        `  dependencies { implementation("${SDK.android.coordinates}:${SDK.android.version}") }`,
        "  plugins { id(\"com.google.gms.google-services\") }   // if not applied yet",
        "  plus com.google.firebase:firebase-auth (sign-in) and firebase-messaging (push), via the Firebase BoM.",
      ];
    case "flutter":
      return [
        "pubspec.yaml:",
        `  dependencies:\n    ${SDK.flutter.package}: ${SDK.flutter.version}\n    firebase_core: any\n    firebase_auth: any\n    firebase_messaging: any`,
        `  or: flutter pub add ${SDK.flutter.package} firebase_core firebase_auth firebase_messaging`,
      ];
  }
}
