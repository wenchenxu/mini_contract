const express = require('express');
const cloudbase = require('@cloudbase/node-sdk');
const dayjs = require('dayjs');
const PDFDocument = require('pdfkit');

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

const tcb = cloudbase.init({
  env: process.env.TENCENTCLOUD_ENV || process.env.CLOUD_BASE_ENV_ID,
  secretId: process.env.TENCENTCLOUD_SECRETID,
  secretKey: process.env.TENCENTCLOUD_SECRETKEY,
});

const db = tcb.database();
const storage = tcb.storage();

const usersCollection = db.collection('users');
const contractsCollection = db.collection('contracts');

function getRequestOpenId(req) {
  return (
    req.headers['x-wx-openid'] ||
    req.headers['x-tcb-openid'] ||
    req.headers['x-openid'] ||
    req.headers['x-dev-openid'] ||
    req.query.openId ||
    process.env.MOCK_OPENID ||
    ''
  );
}

function isAdmin(user) {
  return user && user.role === 'admin';
}

async function authMiddleware(req, res, next) {
  try {
    const openId = getRequestOpenId(req);
    if (!openId) {
      return res.status(401).json({ message: '缺少 openId，无法识别用户身份' });
    }

    const { data } = await usersCollection.where({ openId }).limit(1).get();
    let userRecord = data && data.length > 0 ? data[0] : null;
    const now = new Date();

    if (!userRecord) {
      const createRes = await usersCollection.add({
        openId,
        role: 'user',
        createdAt: now,
        updatedAt: now,
      });
      userRecord = {
        _id: createRes.id,
        openId,
        role: 'user',
        createdAt: now,
        updatedAt: now,
      };
    }

    req.user = {
      id: userRecord._id || userRecord.id,
      openId,
      role: userRecord.role || 'user',
    };

    return next();
  } catch (error) {
    console.error('authMiddleware error', error);
    return res.status(500).json({ message: '用户鉴权失败' });
  }
}

function requireRoles(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: '未登录' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: '无权限执行该操作' });
    }
    return next();
  };
}

function toISO(value) {
  if (!value) return '';
  const date = dayjs(value);
  if (!date.isValid()) return '';
  return date.toISOString();
}

async function buildPdfBuffer(contract) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(20).text('运输服务合同', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12);

      const lines = [
        `合同编号：${contract._id}`,
        `签署日期：${dayjs(contract.updatedAt || new Date()).format('YYYY年MM月DD日')}`,
        '',
        '甲方：__________________________',
        `乙方（司机）：${contract.driverName}`,
        `身份证号：${contract.idNumber}`,
        `出生日期：${contract.birthday}`,
        `常驻城市：${contract.city}`,
        `服务地址：${contract.address}`,
        '',
        '第一条  合同目的',
        '乙方确认遵守甲方的运营与安全规范，确保在提供运输服务期间遵守交通法规及公司制度。',
        '',
        '第二条  服务内容',
        '1. 乙方须按照甲方派工安排执行运输任务；',
        '2. 行程开始前需检查车辆状态并确保证件齐全；',
        '3. 任务完成后向甲方汇报行程及异常情况。',
        '',
        '第三条  费用结算与保密义务',
        '乙方须严格保守甲方及客户信息，不得向第三方披露。费用结算方式以双方另行约定为准。',
        '',
        '第四条  安全责任',
        '乙方需遵守安全驾驶原则，如遇突发事件应立即向甲方报告。因乙方违规导致的损失由乙方承担。',
        '',
        `备注：${contract.extraNotes || '无'}`,
        '',
        '甲方代表（签名）：________________    日期：__________',
        '乙方（签名）：_______________________    日期：__________',
      ];

      lines.forEach((line) => {
        doc.text(line, {
          align: 'left',
          continued: false,
        });
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function generatePdf(contract) {
  const buffer = await buildPdfBuffer(contract);
  const cloudPath = `contracts/${contract._id}-${Date.now()}.pdf`;
  const uploadRes = await storage.uploadFile({
    cloudPath,
    fileContent: buffer,
  });
  const fileId = uploadRes.fileID || uploadRes.fileId;
  if (!fileId) {
    throw new Error('上传 PDF 失败');
  }
  const { fileList } = await storage.getTemporaryUrl({
    fileList: [fileId],
    expireTime: 7200,
  });
  const tempUrl = fileList && fileList[0] ? fileList[0].tempFileURL : '';
  return { fileId, tempUrl };
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.use(authMiddleware);

app.get('/contracts', async (req, res) => {
  try {
    const { role, openId } = req.user;
    const query = role === 'admin' ? {} : { createdBy: openId };
    const { data } = await contractsCollection.where(query).orderBy('createdAt', 'desc').get();

    const fileIds = data.filter((item) => item.pdfFileId).map((item) => item.pdfFileId);
    let tempUrlMap = {};
    if (fileIds.length > 0) {
      const { fileList } = await storage.getTemporaryUrl({
        fileList: fileIds,
        expireTime: 7200,
      });
      tempUrlMap = fileList.reduce((acc, current) => {
        acc[current.fileId] = current.tempFileURL;
        return acc;
      }, {});
    }

    const contracts = data.map((item) => ({
      ...item,
      createdAt: toISO(item.createdAt),
      updatedAt: toISO(item.updatedAt),
      pdfUrl: item.pdfFileId ? tempUrlMap[item.pdfFileId] || '' : '',
    }));

    res.json({ contracts, role });
  } catch (error) {
    console.error('GET /contracts error', error);
    res.status(500).json({ message: '获取合同列表失败' });
  }
});

app.post('/contracts', requireRoles(['user']), async (req, res) => {
  try {
    const payload = req.body || {};
    const requiredFields = ['city', 'address', 'driverName', 'idNumber', 'birthday'];
    for (const field of requiredFields) {
      if (!payload[field]) {
        return res.status(400).json({ message: `${field} 为必填项` });
      }
    }

    const now = new Date();
    const contractData = {
      city: payload.city,
      address: payload.address,
      driverName: payload.driverName,
      idNumber: payload.idNumber,
      birthday: payload.birthday,
      extraNotes: payload.extraNotes || '',
      createdBy: req.user.openId,
      createdAt: now,
      updatedAt: now,
      pdfFileId: '',
    };

    const createRes = await contractsCollection.add(contractData);
    const contractId = createRes.id;
    const contract = { ...contractData, _id: contractId };
    const pdfInfo = await generatePdf(contract);

    await contractsCollection.doc(contractId).update({
      pdfFileId: pdfInfo.fileId,
      updatedAt: now,
    });

    res.status(201).json({
      contract: {
        ...contract,
        pdfFileId: pdfInfo.fileId,
        pdfUrl: pdfInfo.tempUrl,
        createdAt: toISO(contract.createdAt),
        updatedAt: toISO(contract.updatedAt),
      },
    });
  } catch (error) {
    console.error('POST /contracts error', error);
    res.status(500).json({ message: '创建合同失败' });
  }
});

app.put('/contracts/:id', requireRoles(['user']), async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = await contractsCollection.doc(id).get();
    if (!data || data.length === 0) {
      return res.status(404).json({ message: '合同不存在' });
    }
    const contract = data[0];
    if (contract.createdBy !== req.user.openId) {
      return res.status(403).json({ message: '无权修改该合同' });
    }

    const payload = req.body || {};
    const now = new Date();
    const updateData = {
      city: payload.city || contract.city,
      address: payload.address || contract.address,
      driverName: payload.driverName || contract.driverName,
      idNumber: payload.idNumber || contract.idNumber,
      birthday: payload.birthday || contract.birthday,
      extraNotes: payload.extraNotes || contract.extraNotes || '',
      updatedAt: now,
    };

    await contractsCollection.doc(id).update(updateData);
    const updatedContract = { ...contract, ...updateData, _id: id };
    const pdfInfo = await generatePdf(updatedContract);

    await contractsCollection.doc(id).update({
      pdfFileId: pdfInfo.fileId,
      updatedAt: now,
    });

    res.json({
      contract: {
        ...updatedContract,
        pdfFileId: pdfInfo.fileId,
        pdfUrl: pdfInfo.tempUrl,
        createdAt: toISO(contract.createdAt),
        updatedAt: toISO(now),
      },
    });
  } catch (error) {
    console.error('PUT /contracts/:id error', error);
    res.status(500).json({ message: '更新合同失败' });
  }
});

app.delete('/contracts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = await contractsCollection.doc(id).get();
    if (!data || data.length === 0) {
      return res.status(404).json({ message: '合同不存在' });
    }
    const contract = data[0];
    const { role, openId } = req.user;
    if (role !== 'admin' && contract.createdBy !== openId) {
      return res.status(403).json({ message: '无权删除该合同' });
    }

    await contractsCollection.doc(id).remove();
    if (contract.pdfFileId) {
      try {
        await storage.deleteFile({ fileList: [contract.pdfFileId] });
      } catch (deleteErr) {
        console.warn('删除 PDF 失败', deleteErr);
      }
    }
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('DELETE /contracts/:id error', error);
    res.status(500).json({ message: '删除合同失败' });
  }
});

app.get('/contracts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = await contractsCollection.doc(id).get();
    if (!data || data.length === 0) {
      return res.status(404).json({ message: '合同不存在' });
    }
    const contract = data[0];
    if (!isAdmin(req.user) && contract.createdBy !== req.user.openId) {
      return res.status(403).json({ message: '无权查看该合同' });
    }

    let pdfUrl = '';
    if (contract.pdfFileId) {
      const { fileList } = await storage.getTemporaryUrl({
        fileList: [contract.pdfFileId],
        expireTime: 7200,
      });
      pdfUrl = fileList && fileList[0] ? fileList[0].tempFileURL : '';
    }

    res.json({
      contract: {
        ...contract,
        createdAt: toISO(contract.createdAt),
        updatedAt: toISO(contract.updatedAt),
        pdfUrl,
      },
    });
  } catch (error) {
    console.error('GET /contracts/:id error', error);
    res.status(500).json({ message: '获取合同失败' });
  }
});

const port = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Mini contract service listening on port ${port}`);
  });
}

module.exports = app;
