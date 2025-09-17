# 微信小程序云开发合同生成器 MVP 指南

本仓库包含一个最小可行产品（Minimum Viable Product, MVP）的示例实现，帮助你快速搭建面向公司内部的合同生成器。整体方案包含：

* **前端（`frontend/`）**：微信小程序页面，负责采集表单信息、展示合同列表、触发合同生成和下载。
* **后端（`server/`）**：基于 Node.js + Express.js 的云托管服务，通过微信云开发（CloudBase）数据库和存储实现合同的持久化与 PDF 生成。

> ⚠️ 本示例重点展示最简化可以跑通的业务流程，未考虑全面的安全、异常和性能优化。在上线前请结合公司实际情况补充安全控制、权限校验和日志监控等能力。

---

## 一、云开发环境准备

1. **开通环境**：
   - 在微信开发者工具中选择「云开发」-「开通」，创建一个新的环境（例如 `contract-mvp`）。
   - 记录环境 ID，后端部署时需要使用。

2. **数据库集合**（CloudBase Database）：
   - 创建 `users` 集合：用于保存用户角色信息。
     ```json
     {
       "openId": "用户的 openId",
       "role": "user | admin",
       "createdAt": ISODate,
       "updatedAt": ISODate
     }
     ```
   - 创建 `contracts` 集合：用于保存合同内容及 PDF 文件信息。
     ```json
     {
       "city": "城市",
       "address": "详细地址",
       "driverName": "司机姓名",
       "idNumber": "身份证号",
       "birthday": "生日 YYYY-MM-DD",
       "extraNotes": "其他备注，可选",
       "createdBy": "openId",
       "createdAt": ISODate,
       "updatedAt": ISODate,
       "pdfFileId": "存储在 CloudBase 的文件 ID",
       "pdfUrl": "前端临时下载地址（后端返回时动态生成）"
     }
     ```

3. **云存储**（CloudBase Storage）：
   - 默认桶即可，后端会自动在 `contracts/` 目录下上传 PDF。

4. **角色初始化**：
   - 首次调用后端接口时，代码会自动为新用户写入一条 `role = "user"` 的记录。
   - 通过云开发控制台或命令行手动把管理员的 `role` 改为 `admin`。

5. **HTTP 服务域名**：
   - 在云开发控制台 > 云托管或 HTTP 服务 中部署后端（见下文）。
   - 获取服务访问域名（例如 `https://<envId>.service.tcloudbaseapp.com/mini-contract`），前端 `config.js` 里会用到。

---

## 二、部署后端（Express）

1. **本地安装依赖**
   ```bash
   cd server
   npm install
   ```

2. **设置环境变量**
   - 在本地调试时可在 `.env` 中设置：
     ```env
     TENCENTCLOUD_ENV=contract-mvp
     TENCENTCLOUD_SECRETID=你的SecretId
     TENCENTCLOUD_SECRETKEY=你的SecretKey
     ```
   - 在云托管部署时，在「服务设置」中配置同名环境变量。

3. **本地启动调试**（可选）
   ```bash
   npm run dev
   ```
   默认监听 `0.0.0.0:3000`，可用工具如 Postman 进行接口调试。

4. **云托管部署**
   - 在云开发控制台中创建「云托管」服务，选择 **Node.js** 运行环境。
   - 将 `server/` 目录上传，或使用 `tcb hosting deploy` 命令部署。
   - 确保启动命令为 `node index.js`。
   - 部署完成后记录服务路径（如 `/mini-contract`）。

---

## 三、前端小程序配置

1. **导入项目**
   - 在微信开发者工具中选择「小程序」-「导入项目」。
   - 选择 `frontend/` 目录，填写 AppID（需已开通云开发）。

2. **配置云开发**
   - 打开 `app.js`，确认 `wx.cloud.init({ env: '<your-env-id>' })` 使用正确的环境 ID。

3. **配置后端地址**
   - 修改 `frontend/config.js` 中的 `BASE_URL` 为步骤二中获取的云托管域名（包含服务路径）。

4. **本地预览**
   - 在微信开发者工具中点击「预览」或「真机调试」即可测试完整流程。

---

## 四、角色与权限说明

| 角色 | 能力 |
| ---- | ---- |
| user（默认） | 创建、查看、更新、删除自己的合同，生成和下载 PDF |
| admin | 查看所有合同、删除任意合同、下载任意合同 |

> 角色字段存储在 `users` 集合中。管理员可通过控制台直接修改目标用户的 `role` 字段为 `admin`。

后端在处理请求时会读取微信云开发自动注入的 `x-wx-openid` 头，根据 `users` 集合判断权限：

* **普通使用者**仅能访问自己创建的合同。
* **管理员**可以访问所有合同，但不允许创建/修改合同。

---

## 五、流程演示

1. 内部人员打开小程序首页，填写表单并提交。
2. 后端保存合同信息并生成 PDF（存储到云存储，返回临时下载地址）。
3. 首页下方展示合同列表，可点击下载、编辑或删除。
4. 管理员账号登录小程序后可看到所有合同，并执行删除操作。

如需扩展功能（例如更复杂的模板、审批流程或通知），可以在当前结构基础上迭代。

---

## 六、目录结构

```
mini_contract/
├── README.md
├── frontend/           # 小程序源代码
│   ├── app.js
│   ├── app.json
│   ├── app.wxss
│   ├── config.js
│   └── miniprogram/
│       └── pages/
│           └── index/
│               ├── index.js
│               ├── index.json
│               ├── index.wxml
│               └── index.wxss
└── server/             # Express 云托管服务
    ├── index.js
    ├── package.json
    └── package-lock.json (部署后自动生成)
```

祝开发顺利！
