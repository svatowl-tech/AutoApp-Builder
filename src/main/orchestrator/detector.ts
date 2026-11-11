/**
 * @file src/main/orchestrator/detector.ts
 * @description Интеллектуальный детектор типа и стека проекта (Web/React/Vue/Vite/Next/Node,
 *              Python, Rust, Go, C++, Android Native, Flutter) по манифестам и структуре файлов.
 */

import fs from 'fs';
import path from 'path';
import { ProjectDetectionResult } from '../../shared/types.ts';

export class ProjectDetector {
  /**
   * Сканирует директорию распакованного репозитория и возвращает полный профиль проекта
   * с рекомендуемой стратегией «Максимальной бинаризации» (Executable-First).
   */
  public static detectProject(projectDir: string): ProjectDetectionResult {
    if (!fs.existsSync(projectDir)) {
      return {
        stack: 'unknown',
        displayName: 'Директория не найдена',
        framework: 'Unknown',
        entryFile: '',
        detectedManifests: [],
        desktopStrategy: 'Недоступно',
        androidStrategy: 'Недоступно',
        supportsDesktop: false,
        supportsAndroid: false,
      };
    }

    const files = fs.readdirSync(projectDir);
    const hasFile = (name: string) =>
      files.some((f) => f.toLowerCase() === name.toLowerCase());

    const detectedManifests: string[] = [];
    for (const candidate of [
      'package.json',
      'vite.config.ts',
      'vite.config.js',
      'next.config.js',
      'next.config.mjs',
      'requirements.txt',
      'pyproject.toml',
      'main.py',
      'app.py',
      'Cargo.toml',
      'go.mod',
      'CMakeLists.txt',
      'Makefile',
      'pubspec.yaml',
      'build.gradle',
      'build.gradle.kts',
      'index.html',
    ]) {
      if (hasFile(candidate)) {
        detectedManifests.push(candidate);
      }
    }

    // 1. Проверка на Flutter (pubspec.yaml)
    if (hasFile('pubspec.yaml')) {
      return {
        stack: 'flutter',
        displayName: 'Flutter Cross-Platform App',
        framework: 'Flutter SDK',
        entryFile: 'lib/main.dart',
        detectedManifests,
        desktopStrategy:
          'Нативная компиляция Flutter Desktop (flutter build windows/macos/linux --release)',
        androidStrategy: 'Сборка релизного APK через flutter build apk --release',
        supportsDesktop: true,
        supportsAndroid: true,
      };
    }

    // 2. Проверка на нативный Android проект (build.gradle / settings.gradle)
    if (
      hasFile('build.gradle') ||
      hasFile('build.gradle.kts') ||
      hasFile('gradlew')
    ) {
      return {
        stack: 'android-native',
        displayName: 'Android Native (Gradle / Kotlin / Java)',
        framework: 'Android Gradle Plugin',
        entryFile: 'app/build.gradle',
        detectedManifests,
        desktopStrategy:
          'Упаковка JVM/JAR лаунчера или запуск Android APK таргета',
        androidStrategy:
          'Нативная сборка через ./gradlew assembleRelease с единым GRADLE_USER_HOME кэшем',
        supportsDesktop: true,
        supportsAndroid: true,
      };
    }

    // 3. Проверка на Rust (Cargo.toml)
    if (hasFile('Cargo.toml')) {
      return {
        stack: 'rust',
        displayName: 'Rust Native Binary (Cargo)',
        framework: 'Cargo / rustc',
        entryFile: 'src/main.rs',
        detectedManifests,
        desktopStrategy:
          'Релизная компиляция cargo build --release с копированием бинарника в output/',
        androidStrategy:
          'Кросс-компиляция NDK + упаковка в автономный Android APK контейнер',
        supportsDesktop: true,
        supportsAndroid: true,
      };
    }

    // 4. Проверка на Go (go.mod)
    if (hasFile('go.mod')) {
      return {
        stack: 'go',
        displayName: 'Go Native Application',
        framework: 'Go Compiler',
        entryFile: 'main.go',
        detectedManifests,
        desktopStrategy:
          'Стриппингованная сборка go build -ldflags="-s -w" в автономный исполняемый файл',
        androidStrategy: 'Кросс-компиляция Go Mobile / Android APK обертка',
        supportsDesktop: true,
        supportsAndroid: true,
      };
    }

    // 5. Проверка на C++ (CMakeLists.txt / Makefile / main.cpp)
    if (
      hasFile('CMakeLists.txt') ||
      hasFile('main.cpp') ||
      hasFile('Makefile')
    ) {
      return {
        stack: 'cpp',
        displayName: 'C++ Native Project (CMake / G++)',
        framework: hasFile('CMakeLists.txt') ? 'CMake' : 'G++ / Clang',
        entryFile: hasFile('CMakeLists.txt') ? 'CMakeLists.txt' : 'main.cpp',
        detectedManifests,
        desktopStrategy:
          'Релизная компиляция CMake / g++ -O3 -s в нативный исполняемый файл текущей ОС',
        androidStrategy: 'NDK сборка + Android NativeActivity APK',
        supportsDesktop: true,
        supportsAndroid: false,
      };
    }

    // 6. Проверка на Python (requirements.txt, pyproject.toml, main.py, app.py)
    if (
      hasFile('requirements.txt') ||
      hasFile('pyproject.toml') ||
      hasFile('main.py') ||
      hasFile('app.py')
    ) {
      const entryPy = hasFile('main.py')
        ? 'main.py'
        : hasFile('app.py')
          ? 'app.py'
          : files.find((f) => f.endsWith('.py')) || 'main.py';

      return {
        stack: 'python',
        displayName: 'Python Application (PyInstaller)',
        framework: 'Python + PyInstaller',
        entryFile: entryPy,
        detectedManifests,
        desktopStrategy: `Изолированный venv + pip (общий кэш) + pyinstaller --noconfirm --onefile --windowed ${entryPy}`,
        androidStrategy: 'Упаковка веб/GUI интерфейса Python в Capacitor APK контейнер',
        supportsDesktop: true,
        supportsAndroid: true,
      };
    }

    // 7. Проверка на Web / Node.js (package.json или index.html)
    if (hasFile('package.json')) {
      try {
        const pkgRaw = fs.readFileSync(
          path.join(projectDir, 'package.json'),
          'utf-8',
        );
        const pkg = JSON.parse(pkgRaw) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          scripts?: Record<string, string>;
          main?: string;
        };
        const allDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };

        let framework = 'Node.js';
        let isFrontend = false;

        if (allDeps['next']) {
          framework = 'Next.js';
          isFrontend = true;
        } else if (allDeps['react'] && allDeps['vite']) {
          framework = 'React + Vite';
          isFrontend = true;
        } else if (allDeps['vue']) {
          framework = 'Vue.js + Vite';
          isFrontend = true;
        } else if (allDeps['svelte']) {
          framework = 'Svelte';
          isFrontend = true;
        } else if (allDeps['react']) {
          framework = 'React SPA';
          isFrontend = true;
        } else if (allDeps['express'] || allDeps['fastify']) {
          framework = 'Node.js Backend / Express';
          isFrontend = Boolean(hasFile('index.html'));
        }

        const hostTargetExt =
          process.platform === 'win32'
            ? '.exe (Portable)'
            : process.platform === 'darwin'
              ? '.dmg / .app'
              : '.AppImage';

        return {
          stack: isFrontend ? 'web-frontend' : 'web-node',
          displayName: `${framework} Project`,
          framework,
          entryFile: 'package.json',
          detectedManifests,
          desktopStrategy: isFrontend
            ? `Сборка npm run build + инъекция шаблона Electron-контейнера -> упаковка в ${hostTargetExt}`
            : `Сборка бандла + упаковка в автономный исполняемый файл Node SEA / Electron ${hostTargetExt}`,
          androidStrategy:
            'Генерация оболочки @capacitor/core + @capacitor/android и сборка автономного .apk через Gradle',
          supportsDesktop: true,
          supportsAndroid: true,
        };
      } catch {
        // Ошибка чтения package.json
      }
    }

    if (hasFile('index.html')) {
      return {
        stack: 'web-frontend',
        displayName: 'Static HTML5 / JS Application',
        framework: 'HTML5 + Vanilla JS/CSS',
        entryFile: 'index.html',
        detectedManifests,
        desktopStrategy:
          'Инъекция в подготовленный шаблон Electron-контейнера (electron-wrapper) и упаковка в нативный бинарник',
        androidStrategy:
          'Оборачивание статики в @capacitor/android и компиляция автономного .apk',
        supportsDesktop: true,
        supportsAndroid: true,
      };
    }

    return {
      stack: 'unknown',
      displayName: 'Универсальный проект исходного кода',
      framework: 'Generic Source',
      entryFile: files[0] || '',
      detectedManifests,
      desktopStrategy: 'Упаковка в портативный самораспаковывающийся контейнер текущей ОС',
      androidStrategy: 'Упаковка ресурсов в гибридный APK-контейнер',
      supportsDesktop: true,
      supportsAndroid: true,
    };
  }
}
