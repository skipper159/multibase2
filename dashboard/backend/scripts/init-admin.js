const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createInitialAdmin() {
  try {
    const existingUser = await prisma.user.findFirst();

    if (existingUser) {
      console.log('Users already exist. Skipping initialization.');
      return;
    }

    // The installer must provide an explicit temporary password. Never fall
    // back to a publicly known credential.
    const password = process.env.DEFAULT_ADMIN_PASSWORD?.trim();
    if (!password) {
      throw new Error('DEFAULT_ADMIN_PASSWORD is required to create the initial admin');
    }

    const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@multibase.local';
    const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        mustChangePassword: true,
        role: 'admin',
      },
    });

    console.log('Initial admin user created successfully.');
    console.log(`Email: ${email}`);
    console.log(`Username: ${username}`);
    console.log('A password change is required at first login.');
  } catch (error) {
    console.error('Error creating admin user:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createInitialAdmin()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
