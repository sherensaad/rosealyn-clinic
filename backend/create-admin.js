const bcrypt = require("bcrypt");
const db = require("./db");
require("dotenv").config();

async function createAdmins() {
  try {
    // إضافة عمود الفرع لو مش موجود
    try {
      await db.execute(`
        ALTER TABLE admin_users
        ADD COLUMN branch VARCHAR(100) NULL AFTER username
      `);
    } catch (error) {
      // لو العمود موجود بالفعل، تجاهلي الخطأ
    }

    const admins = [
      {
        username: "obour",
        password: "1234",
        branch: "فرع العبور"
      },
      {
        username: "meet",
        password: "1234",
        branch: "فرع ميت غمر"
      },
      {
        username: "minya",
        password: "1234",
        branch: "فرع المنيا"
      }
    ];

    for (const admin of admins) {
      const hashedPassword = await bcrypt.hash(admin.password, 10);

      const sql = `
        INSERT INTO admin_users (username, branch, password)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          password = VALUES(password),
          branch = VALUES(branch)
      `;

      await db.execute(sql, [
        admin.username,
        admin.branch,
        hashedPassword
      ]);
    }

    console.log("Branch admins created/updated successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error creating admins:", error);
    process.exit(1);
  }
}

createAdmins();