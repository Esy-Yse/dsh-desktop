# DeepSeek Harness Windows Launcher

这是一个按开源仓库方式整理的 Windows 发行包，包含上游 DeepSeek Harness 源码、特点是包含无边框可运行的DSH，内置鲸歌作为默认皮肤
桌面启动器源码与测试，以及可直接运行的 Windows 便携版。
![Uploading QQ_1787049114165.png…]()


## 目录

- `apps/desktop-launcher`：Electron 启动器的可维护源码、打包脚本和测试。
- `upstream/deepseek-harness`：DeepSeek Harness 上游源码、文档和锁文件。
- `dist/windows-portable`：可直接运行的 Windows 便携版；启动 `DeepSeek Harness.exe`。
- `docs`：运行说明、上游项目说明与贡献指南。


## 从源码恢复依赖

上游项目和启动器均保留了依赖清单与锁文件，但不包含 `node_modules`、pnpm 缓存、
构建缓存和安装日志。进入相应目录后按其 README 使用包管理器安装依赖即可恢复开发环境。

## 许可证与说明

上游 DeepSeek Harness 使用 MIT 许可证；第三方依赖许可证见
`upstream/deepseek-harness/THIRD_PARTY_NOTICES.md` 及便携版目录中的许可证文件。
DeepSeek Harness 目前处于 developer preview，可能出现不兼容更新。
