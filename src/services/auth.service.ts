import axios from 'axios';
import pool from '../config/database.js';

interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

export const authService = {
  /**
   * Verify LINE Access Token and return user profile
   */
  async verifyLineToken(accessToken: string): Promise<{
    user: {
      id: number;
      role: string;
      displayName: string;
      lineUserId: string;
      status: string;
    };
    lineProfile: LineProfile;
  }> {
    
    // 🔓 DEV MODE: Bypass LINE authentication
    if (accessToken === 'dev-token' || accessToken.startsWith('dev-token-')) {
      const devRole = accessToken.startsWith('dev-token-') ? accessToken.replace('dev-token-', '') : 'admin';
      const validRoles = ['admin', 'supervisor', 'technician'];
      const role = validRoles.includes(devRole) ? devRole : 'admin';
      console.log(`🔓 DEV MODE: Bypassing LINE authentication as ${role}`);
      
      return {
        user: {
          id: 1,
          lineUserId: `dev-user-${role}`,
          displayName: `Dev ${role.charAt(0).toUpperCase() + role.slice(1)}`,
          status: 'active',
          role: role
        },
        lineProfile: {
          userId: `dev-user-${role}`,
          displayName: `Dev ${role.charAt(0).toUpperCase() + role.slice(1)}`,
          pictureUrl: 'https://via.placeholder.com/150'
        }
      };
    }

    // Verify token with LINE API
    const lineResponse = await axios.get<LineProfile>('https://api.line.me/v2/profile', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const lineProfile = lineResponse.data;
    const lineUserId = lineProfile.userId;

    // Check if user exists in database
    const userQuery = await pool.query(
      'SELECT id, role, display_name, line_user_id, status FROM maintenance_users WHERE line_user_id = $1',
      [lineUserId]
    );

    if (userQuery.rows.length === 0) {
        throw new Error('User not found in database');
    }

    return {
      user: {
        id: userQuery.rows[0].id,
        role: userQuery.rows[0].role,
        displayName: userQuery.rows[0].display_name,
        lineUserId: userQuery.rows[0].line_user_id,
        status: userQuery.rows[0].status
      },
      lineProfile
    };
  }
};
