const API_URL = import.meta.env.VITE_API_URL;

export const usersAPI = {
  // ดึงรายชื่อผู้ใช้ทั้งหมด
  list: async (userId) => {
    const response = await fetch(`${API_URL}/users/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch users');
    }

    return response.json();
  },

  // เพิ่มผู้ใช้ใหม่
  add: async (userId, userData) => {
    const response = await fetch(`${API_URL}/users/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        userId,
        ...userData 
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add user');
    }

    return response.json();
  },

  // อัพเดทข้อมูลผู้ใช้
  update: async (userId, targetUserId, userData) => {
    const response = await fetch(`${API_URL}/users/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        userId,
        targetUserId,
        ...userData 
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update user');
    }

    return response.json();
  },

  // ลบผู้ใช้
  delete: async (userId, targetUserId) => {
    const response = await fetch(`${API_URL}/users/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        userId,
        targetUserId 
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete user');
    }

    return response.json();
  },

  // ค้นหาผู้ใช้จาก LINE User ID
  search: async (userId, lineUserId) => {
    const response = await fetch(`${API_URL}/users/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        userId,
        lineUserId 
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to search user');
    }

    return response.json();
  },
};
