const { BASE_URL } = require('../../../config');

const DEFAULT_FORM = {
  city: '',
  address: '',
  driverName: '',
  idNumber: '',
  birthday: '',
  extraNotes: '',
};

Page({
  data: {
    form: { ...DEFAULT_FORM },
    loading: false,
    contracts: [],
    editingId: '',
    userRole: 'user',
  },

  onLoad() {
    this.fetchContracts();
  },

  onPullDownRefresh() {
    this.fetchContracts(true);
  },

  handleFieldChange(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    if (!field) return;
    this.setData({ [`form.${field}`]: value });
  },

  handleDateChange(event) {
    const value = event.detail.value;
    this.setData({ 'form.birthday': value });
  },

  validateForm() {
    const required = [
      { key: 'city', label: '城市' },
      { key: 'address', label: '地址' },
      { key: 'driverName', label: '司机姓名' },
      { key: 'idNumber', label: '身份证号' },
      { key: 'birthday', label: '出生日期' },
    ];
    for (const item of required) {
      if (!this.data.form[item.key]) {
        wx.showToast({ title: `${item.label}不能为空`, icon: 'none' });
        return false;
      }
    }
    return true;
  },

  handleSubmit() {
    if (this.data.userRole === 'admin') {
      wx.showToast({ title: '管理员无法创建或修改合同', icon: 'none' });
      return;
    }
    if (!this.validateForm()) {
      return;
    }
    this.setData({ loading: true });
    const isEditing = !!this.data.editingId;
    const url = isEditing
      ? `${BASE_URL}/contracts/${this.data.editingId}`
      : `${BASE_URL}/contracts`;
    const method = isEditing ? 'PUT' : 'POST';

    wx.request({
      url,
      method,
      header: { 'content-type': 'application/json' },
      data: this.data.form,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          wx.showToast({ title: isEditing ? '已更新' : '创建成功', icon: 'success' });
          this.handleReset();
          this.fetchContracts();
        } else {
          wx.showToast({
            title: res.data?.message || '操作失败',
            icon: 'none',
          });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络异常，请稍后再试', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
      },
    });
  },

  handleReset() {
    this.setData({
      form: { ...DEFAULT_FORM },
      editingId: '',
    });
  },

  fetchContracts(showLoading = false) {
    if (showLoading) {
      wx.showNavigationBarLoading();
    }
    wx.request({
      url: `${BASE_URL}/contracts`,
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200) {
          const { contracts = [], role = 'user' } = res.data || {};
          const mapped = contracts.map((item) => ({
            ...item,
            createdAtDisplay: this.formatDateTime(item.createdAt),
          }));
          this.setData({ contracts: mapped, userRole: role });
        } else {
          wx.showToast({ title: res.data?.message || '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '加载失败，请检查网络', icon: 'none' });
      },
      complete: () => {
        if (showLoading) {
          wx.hideNavigationBarLoading();
        }
        wx.stopPullDownRefresh();
      },
    });
  },

  handleEdit(event) {
    if (this.data.userRole === 'admin') {
      wx.showToast({ title: '管理员无法编辑合同', icon: 'none' });
      return;
    }
    const id = event.currentTarget.dataset.id;
    const contract = this.data.contracts.find((item) => item._id === id);
    if (!contract) {
      wx.showToast({ title: '未找到合同', icon: 'none' });
      return;
    }
    this.setData({
      editingId: id,
      form: {
        city: contract.city || '',
        address: contract.address || '',
        driverName: contract.driverName || '',
        idNumber: contract.idNumber || '',
        birthday: contract.birthday || '',
        extraNotes: contract.extraNotes || '',
      },
    });
  },

  handleDelete(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '删除确认',
      content: '确定删除该合同吗？此操作不可恢复。',
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        wx.request({
          url: `${BASE_URL}/contracts/${id}`,
          method: 'DELETE',
          success: (res) => {
            if (res.statusCode === 200) {
              wx.showToast({ title: '已删除', icon: 'success' });
              if (this.data.editingId === id) {
                this.handleReset();
              }
              this.fetchContracts();
            } else {
              wx.showToast({ title: res.data?.message || '删除失败', icon: 'none' });
            }
          },
          fail: () => {
            wx.showToast({ title: '删除失败，请稍后再试', icon: 'none' });
          },
        });
      },
    });
  },

  handleDownload(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) {
      wx.showToast({ title: '暂无 PDF，请先生成', icon: 'none' });
      return;
    }
    wx.downloadFile({
      url,
      success: (res) => {
        const filePath = res.tempFilePath;
        wx.openDocument({
          filePath,
          showMenu: true,
        });
      },
      fail: () => {
        wx.showToast({ title: '下载失败，请稍后再试', icon: 'none' });
      },
    });
  },

  formatDateTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    const pad = (num) => (num < 10 ? `0${num}` : num);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },
});
