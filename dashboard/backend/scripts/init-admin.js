const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createInitialAdmin() {
  try {
    // Check if any user exists
    const existingUser = await prisma.user.findFirst();
    
    if (existingUser) {
      console.log('ℹ️  Users already exist. Skipping initialization.');
      return;
    }

    // Create admin user
    const passwordHash = await bcrypt.hash('admin123', 10);
    
    const admin = await prisma.user.create({
      data: {
        email: 'admin@multibase.local',
        username: 'admin',
        passwordHash,
        role: 'admin',
      },
    });

    console.log('✅ Initial admin user created successfully!');
    console.log('');
    console.log('📧 Email: admin@multibase.local');
    console.log('👤 Username: admin');
    console.log('🔑 Password: admin123');
    console.log('');
    console.log('⚠️  Please change the password after first login!');
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createInitialAdmin()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
