# 来源与许可证

本版本基于[YusongXiao/fuckuooc](https://github.com/YusongXiao/fuckuooc)的MIT代码及后续本地维护代码扩展，原快照包名为fuckuooc-main，完整保留原MIT许可证。核验上游提交ec472a0cd767411c00950f448ec6d266dc49d67c；本地包含课程识别、主答/裁决、提交保护、启动引导和发布工程的独立修改，并非与当前上游功能完全相同的镜像。

UOOC选项填写与提交行为曾参考zcx28/szu-uooc用户脚本的设计思路，本地对应实现见utils/choice-actions.js及utils/submission.js。参考版本4e6a17ecd34d45585a775a5dbd3a32c79665c7f0；该用户脚本标注MIT。参考仓库：https://github.com/zcx28/szu-uooc。发行包未包含该项目的安装器、题库、第三方API Key或个人登录信息。

依赖Playwright及playwright-core，按各自随包LICENSE和NOTICE分发。Windows运行包附带官方Node.js，许可证和来源校验信息放在app/runtime。Microsoft Edge由用户自行安装，本项目不分发Edge。

新增启动、构建模块复用同作者维护的zhihuishu-course-assistant中的MIT代码。UOOC与智慧树是不同项目，本工具不是平台官方软件。
