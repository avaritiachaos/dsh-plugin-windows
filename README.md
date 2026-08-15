# @shion-lab/dsh-plugin-windows

[![npm version](https://img.shields.io/npm/v/@shion-lab/dsh-plugin-windows.svg)](https://www.npmjs.com/package/@shion-lab/dsh-plugin-windows)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Windows cross-platform compatibility, process tree termination (`taskkill /T`), path normalization, and encoding buffer guards for DeepSeek Harness (`dsh`).**

---

## 🌟 Problems Solved for Windows Users

When running AI coding agents natively on Windows, developers frequently face three platform-specific issues:

1. **Zombie Orphaned Processes**: `child_process.kill()` fails to terminate sub-processes spawned by shells (e.g. `webpack-dev-server`, `python`, background workers), locking ports and files. This plugin enforces **recursive process tree termination** via `taskkill /F /T /PID`.
2. **Path Normalization & Extended-Length Prefixes**: Resolves Windows drive letter cases (`d:\` vs `D:/`), strips `\\?\` UNC prefixes, and normalizes paths for cross-platform regex and glob matches.
3. **Encoding & BOM Cleansing**: Automatically handles UTF-8 BOM headers (`\uFEFF`) and CRLF line endings, avoiding garbled terminal output.

---

## 📦 Installation

```bash
npm install -g @shion-lab/dsh-plugin-windows
```

---

## 🚀 Usage in `cordis.yml`

```yaml
plugins:
  "@deepseek-ai/dsh": {}
  "@shion-lab/dsh-plugin-windows":
    forceUtf8: true
    enableProcessTreeGuard: true
```

---

## 📄 License

MIT © [Shion Lab](https://github.com/shion-lab)
