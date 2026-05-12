const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { google } = require("googleapis");
const db = require("./db");
require("dotenv").config();

/* =========================
   Green API — per-branch
========================= */
const BRANCH_GREEN_API = {
  "فرع المنيا": {
    instance: "7107602078",
    token: "88db43f8bc48410b8ea2bb7caacc0661de7f3e22486c4719a1",
  },
  "فرع ميت غمر": {
    instance: "7107603446",
    token: "2959f3c69594462d9d7f2b96cde422d390a2ab990e2d406caa",
  },
  "فرع العبور": {
    instance: "7107603447",
    token: "8590d01dd6ac487588a9e5ec23126aef24d93578986d426fb1",
  },
};

function formatPhoneForWA(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "2" + p;
  else if (!p.startsWith("20")) p = "20" + p;
  return p + "@c.us";
}

async function sendWhatsAppMessage(phone, message, branch) {
  const creds = BRANCH_GREEN_API[branch];
  if (!creds) {
    console.warn("⚠️ لا يوجد إعداد Green API للفرع:", branch);
    return false;
  }
  const chatId = formatPhoneForWA(phone);
  const url =
    "https://api.green-api.com/waInstance" +
    creds.instance +
    "/sendMessage/" +
    creds.token;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message }),
    });
    const d = await r.json();
    if (d.idMessage) {
      console.log("✅ WA sent [" + branch + "] → " + phone);
      return true;
    }
    console.error("❌ WA failed [" + branch + "]:", JSON.stringify(d));
    return false;
  } catch (err) {
    console.error("❌ WA error:", err.message);
    return false;
  }
}

/* =========================
   Cron Job — تذكيرات تلقائية كل يوم الساعة 9 صباحاً
========================= */

function startReminderCron() {
  async function runDailyReminders() {
    const now = new Date();
    console.log(
      `\n🔔 Reminder Cron — بدأ التشغيل: ${now.toLocaleString("ar-EG")}`,
    );
    try {
      const [allSettings] = await db.execute(
        "SELECT * FROM reminder_settings WHERE is_active = 1",
      );
      if (allSettings.length === 0) {
        console.log("ℹ️  لا توجد فروع مفعّل فيها التذكير");
        return;
      }
      let totalSent = 0;
      let totalSkipped = 0;

      for (const settings of allSettings) {
        const {
          branch,
          days_after: daysAfter,
          message_template: template,
        } = settings;

        const [clients] = await db.execute(
          `SELECT b.id, b.full_name, b.phone, b.service, b.body_area, b.preferred_date
           FROM bookings b
           WHERE b.branch = ?
             AND b.status IN ('مكتمل', 'تم التأكيد', 'تم الحضور')
             AND DATE(b.preferred_date) = DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
          [branch, daysAfter],
        );

        if (clients.length === 0) {
          console.log(`  📭 ${branch}: لا توجد عميلات مستحقة اليوم`);
          continue;
        }
        console.log(`  📋 ${branch}: ${clients.length} عميلة مستحقة`);

        for (const client of clients) {
          const [already] = await db.execute(
            "SELECT id FROM reminder_logs WHERE booking_id = ? AND status = 'sent' LIMIT 1",
            [client.id],
          );
          if (already.length > 0) {
            console.log(`  ⏭️  تم التخطي (مبعوت مسبقاً): ${client.full_name}`);
            totalSkipped++;
            continue;
          }

          const dateStr = client.preferred_date
            ? String(client.preferred_date).slice(0, 10)
            : "";
          const message = template
            .replace(/{name}/g, client.full_name || "")
            .replace(/{service}/g, client.service || "")
            .replace(/{area}/g, client.body_area || "")
            .replace(/{date}/g, dateStr);

          const sent = await sendWhatsAppMessage(client.phone, message, branch);

          await db.execute(
            `INSERT INTO reminder_logs (booking_id, branch, phone, full_name, sent_at, status)
             VALUES (?, ?, ?, ?, NOW(), ?)`,
            [
              client.id,
              branch,
              client.phone,
              client.full_name,
              sent ? "sent" : "failed",
            ],
          );

          if (sent) totalSent++;
          else totalSkipped++;

          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      console.log(
        `✅ Cron انتهى — أُرسل: ${totalSent} | فشل/تخطي: ${totalSkipped}\n`,
      );
    } catch (err) {
      console.error("❌ Cron error:", err.message);
    }
  }

  async function getEarliestSendTime() {
    try {
      const [rows] = await db.execute(
        "SELECT send_time FROM reminder_settings WHERE is_active = 1 ORDER BY send_time ASC LIMIT 1",
      );
      return (rows[0]?.send_time || "09:00").slice(0, 5);
    } catch (_) {
      return "09:00";
    }
  }

  async function scheduleCron() {
    const sendTime = await getEarliestSendTime();
    const [h, m] = sendTime.split(":").map(Number);

    function msUntilNext() {
      const now = new Date();
      const next = new Date(now);
      next.setHours(h, m, 0, 0);
      if (now >= next) next.setDate(next.getDate() + 1);
      return next - now;
    }

    setTimeout(async function scheduleLoop() {
      await runDailyReminders();

      const updatedTime = await getEarliestSendTime();
      const [nh, nm] = updatedTime.split(":").map(Number);

      function msNext() {
        const now = new Date();
        const next = new Date(now);
        next.setHours(nh, nm, 0, 0);
        if (now >= next) next.setDate(next.getDate() + 1);
        return next - now;
      }

      setTimeout(scheduleLoop, msNext());
    }, msUntilNext());

    const hours = (msUntilNext() / 3600000).toFixed(1);
    console.log(
      `⏰ Reminder Cron جاهز — التشغيل القادم بعد ${hours} ساعة (${sendTime})`,
    );
  }

  scheduleCron();
}

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "rosalyn_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 1000 * 60 * 60 * 2,
    },
  }),
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    message: "طلبات كثيرة جدًا، حاولي مرة أخرى بعد قليل",
  },
});

app.use("/api", limiter);
app.use(express.static(path.join(__dirname, "public")));

const ALLOWED_BRANCHES = ["فرع العبور", "فرع ميت غمر", "فرع المنيا"];

/* =========================
   مواعيد تلقائية كل 30 دقيقة
   العبور: 9 صباحًا لـ 9 مساءً
   المنيا وميت غمر: 9 صباحًا لـ 10 مساءً
========================= */

function generateTimeSlots(branch) {
  let endHour = 22;

  if (branch === "فرع العبور") {
    endHour = 21;
  }

  if (branch === "فرع المنيا" || branch === "فرع ميت غمر") {
    endHour = 22;
  }

  const slots = [];

  for (let hour = 9; hour < endHour; hour++) {
    slots.push(`${String(hour).padStart(2, "0")}:00`);
    slots.push(`${String(hour).padStart(2, "0")}:30`);
  }

  return slots;
}

function isValidPhone(phone) {
  const cleaned = String(phone || "").replace(/[\s\-().]/g, "");
  return /^(\+20|20|0)1[0-25][0-9]{8}$/.test(cleaned);
}

function sanitizeText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function requireAdminAuth(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({
      success: false,
      message: "غير مصرح، برجاء تسجيل الدخول أولًا",
    });
  }

  req.adminBranch = req.session.adminBranch;
  next();
}

/* =========================
   Google Sheets Helpers
========================= */

const BRANCH_SHEET_IDS = {
  "فرع العبور": "1WXmPnCXiBDjOpm4qfdg4mXDDGmj97vAOIW0xwCgRWi0",
  "فرع ميت غمر": "1D0yqhDXNqBbsnBjGzCoeB1KjN3wGsnZOH_QbTlarFj4",
  "فرع المنيا": "1Cjur0o0j5zzAsGHUjLMS2ggnXepgW-UcI6btWYCW1UE",
};

function getBranchSpreadsheetId(branch) {
  const id = BRANCH_SHEET_IDS[branch];
  if (!id) {
    console.error(`❌ Google Sheets: لا يوجد Sheet ID للفرع: ${branch}`);
    return null;
  }
  return id;
}

function getGoogleCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

  if (!raw || raw.trim() === "" || raw.includes("...")) {
    console.error(
      "❌ Google Sheets: GOOGLE_SERVICE_ACCOUNT_JSON غير موجود أو غير مكتمل في ملف .env",
    );
    return null;
  }

  try {
    const cleaned = raw.trim().replace(/^'|'$/g, "").replace(/^"|"$/g, "");
    const credentials = JSON.parse(cleaned);

    if (!credentials.client_email) {
      console.error("❌ Google Sheets: client_email مش موجود في credentials");
      return null;
    }

    if (!credentials.private_key) {
      console.error("❌ Google Sheets: private_key مش موجود في credentials");
      return null;
    }

    return credentials;
  } catch (err) {
    console.error("❌ Google Sheets: خطأ في parsing الـ JSON:", err.message);
    console.error(
      "   تأكدي إن GOOGLE_SERVICE_ACCOUNT_JSON في .env هو JSON صحيح بدون quotes خارجية",
    );
    return null;
  }
}

const SHEET_HEADERS = [
  "ID",
  "الاسم",
  "الهاتف",
  "الفرع",
  "العمر",
  "الخدمة",
  "المنطقة",
  "التاريخ",
  "الوقت",
  "نوع الجلسة",
  "طريقة التواصل",
  "الحالة",
  "ملاحظات طبية",
  "تاريخ الحجز",
];

const BOOKINGS_TAB = "الحجوزات";

async function getOrCreateBookingsTab(sheets, spreadsheetId) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = meta.data.sheets.map((s) => s.properties.title);

    if (!existing.includes(BOOKINGS_TAB)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: BOOKINGS_TAB } } }],
        },
      });
      console.log(`✅ Google Sheets: تم إنشاء تاب "${BOOKINGS_TAB}"`);
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${BOOKINGS_TAB}!A1:N1`,
    });

    const firstRow = (res.data.values || [])[0] || [];
    const isCorrect = SHEET_HEADERS.every((h, i) => firstRow[i] === h);

    if (!isCorrect) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${BOOKINGS_TAB}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [SHEET_HEADERS] },
      });
      console.log(`✅ Google Sheets: تم كتابة الهيدر في تاب "${BOOKINGS_TAB}"`);
    }

    return BOOKINGS_TAB;
  } catch (err) {
    console.error(
      "❌ Google Sheets: خطأ في getOrCreateBookingsTab:",
      err.message,
    );
    return null;
  }
}

async function appendToSheet(rowData, branch) {
  try {
    console.log(`🔵 appendToSheet called - branch: "${branch}"`);

    const credentials = getGoogleCredentials();
    if (!credentials) {
      console.error("🔴 appendToSheet: credentials فاشلة");
      return;
    }

    const spreadsheetId = getBranchSpreadsheetId(branch);
    if (!spreadsheetId) {
      console.error(`🔴 appendToSheet: مفيش spreadsheetId للفرع "${branch}"`);
      return;
    }

    console.log(`🔵 spreadsheetId = ${spreadsheetId}`);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const tabName = await getOrCreateBookingsTab(sheets, spreadsheetId);
    if (!tabName) {
      console.error(`🔴 appendToSheet: فشل في إنشاء تاب الحجوزات`);
      return;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowData] },
    });

    console.log(
      `✅ Google Sheets (${branch}): تم إضافة الصف بنجاح، ID: ${rowData[0]}`,
    );
  } catch (err) {
    console.error(`🔴 Google Sheets append error (${branch}):`, err.message);
    if (
      err.message &&
      err.message.includes("The caller does not have permission")
    ) {
      console.error(
        `   ⚠️  تأكدي إن الشيت بتاع "${branch}" مضافالو service account كـ Editor`,
      );
    }
  }
}

async function updateSheetRow(bookingId, status, branch) {
  try {
    const credentials = getGoogleCredentials();
    if (!credentials) return;

    const spreadsheetId = getBranchSpreadsheetId(branch);
    if (!spreadsheetId) return;

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${BOOKINGS_TAB}!A:A`,
    });

    const rows = res.data.values || [];
    let targetRow = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(bookingId)) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) {
      console.warn(
        `⚠️ Google Sheets: لم يتم إيجاد الصف للـ bookingId: ${bookingId} في شيت الفرع: ${branch}`,
      );
      return;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${BOOKINGS_TAB}!L${targetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[status]] },
    });

    console.log(
      `✅ Google Sheets (${branch}): تم تحديث الحالة، ID: ${bookingId} → ${status}`,
    );
  } catch (err) {
    console.error("❌ Google Sheets update error:", err.message);
  }
}

/* =========================
   Database Initialization
========================= */

async function initializeDatabase() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        branch VARCHAR(100) NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await db.execute(`
        ALTER TABLE admin_users
        ADD COLUMN branch VARCHAR(100) NULL AFTER username
      `);
    } catch (_) {}

    await db.execute(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        branch VARCHAR(100) NULL,
        age INT NULL,
        service VARCHAR(255) NOT NULL,
        body_area VARCHAR(255) NULL,
        preferred_date VARCHAR(50) NULL,
        preferred_time VARCHAR(50) NULL,
        session_type VARCHAR(255) NULL,
        contact_method VARCHAR(255) NULL,
        medical_notes TEXT NULL,
        status VARCHAR(100) DEFAULT 'طلب جديد',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await db.execute(`
        ALTER TABLE bookings
        ADD COLUMN branch VARCHAR(100) NULL AFTER phone
      `);
    } catch (_) {}

    try {
      await db.execute(`
        ALTER TABLE bookings
        DROP COLUMN email
      `);
    } catch (_) {}

    await db.execute(`
      CREATE TABLE IF NOT EXISTS available_slots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch VARCHAR(100) NOT NULL,
        slot_date VARCHAR(50) NOT NULL,
        slot_time VARCHAR(50) NOT NULL,
        is_booked TINYINT(1) DEFAULT 0,
        booking_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS finances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch VARCHAR(100) NULL,
        finance_date VARCHAR(50) NULL,
        client_name VARCHAR(255) NOT NULL,
        service_area VARCHAR(255) NULL,
        total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        remaining_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        payment_method VARCHAR(100) DEFAULT 'كاش',
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const newFinanceCols = [
      "branch",
      "finance_date",
      "service_area",
      "payment_method",
      "notes",
    ];
    for (const col of newFinanceCols) {
      try {
        const colDefs = {
          branch: "VARCHAR(100) NULL AFTER id",
          finance_date: "VARCHAR(50) NULL AFTER branch",
          service_area: "VARCHAR(255) NULL AFTER client_name",
          payment_method: "VARCHAR(100) DEFAULT 'كاش' AFTER remaining_amount",
          notes: "TEXT NULL AFTER payment_method",
        };
        await db.execute(
          `ALTER TABLE finances ADD COLUMN ${col} ${colDefs[col]}`,
        );
      } catch (_) {}
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        price VARCHAR(100) NOT NULL,
        tag VARCHAR(100) DEFAULT '',
        is_featured TINYINT(1) DEFAULT 0,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS offers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        price VARCHAR(100) NOT NULL,
        label VARCHAR(100) DEFAULT '',
        features TEXT NULL,
        is_highlighted TINYINT(1) DEFAULT 0,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS reminder_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch VARCHAR(100) NOT NULL,
        days_after INT NOT NULL DEFAULT 21,
        send_time VARCHAR(5) NOT NULL DEFAULT '09:00',
        message_template TEXT NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_branch (branch)
      )
    `);

    try {
      await db.execute(
        "ALTER TABLE reminder_settings ADD COLUMN send_time VARCHAR(5) NOT NULL DEFAULT '09:00' AFTER days_after",
      );
    } catch (_) {}

    await db.execute(`
      CREATE TABLE IF NOT EXISTS reminder_logs (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        booking_id  INT NOT NULL,
        branch      VARCHAR(100) NULL,
        phone       VARCHAR(50)  NULL,
        full_name   VARCHAR(255) NULL,
        sent_at     DATETIME     NOT NULL,
        status      VARCHAR(20)  DEFAULT 'sent',
        INDEX idx_booking (booking_id),
        INDEX idx_sent_at (sent_at)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS session_operations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch VARCHAR(100) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NULL,
        service VARCHAR(255) NULL,
        body_area VARCHAR(255) NULL,
        operation_date DATE NOT NULL,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_branch (branch),
        INDEX idx_operation_date (operation_date)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS extra_contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_branch (branch)
      )
    `);

    const defaultTemplate = `أهلاً {name} 💐\nنتمنى تجربتك مع ROSALYN كانت رائعة!\nحان وقت جلستك التالية 🌸\nاتواصلي معانا لتحديد موعدك القادم ✨`;

    const branches = ["فرع العبور", "فرع ميت غمر", "فرع المنيا"];
    for (const branch of branches) {
      try {
        await db.execute(
          `INSERT IGNORE INTO reminder_settings (branch, days_after, message_template, is_active)
           VALUES (?, 21, ?, 1)`,
          [branch, defaultTemplate],
        );
      } catch (_) {}
    }

    const [servicesRows] = await db.execute(
      "SELECT COUNT(*) AS count FROM services",
    );
    if (servicesRows[0].count === 0) {
      await db.execute(`
        INSERT INTO services (name, description, price, tag, is_featured, sort_order)
        VALUES
        ('إزالة الشعر بالليزر', 'جلسات دقيقة وآمنة لتقليل نمو الشعر وتحقيق راحة أكبر ونتائج أفضل.', 'Starting from 300 EGP', 'الأكثر طلبًا', 1, 1),
        ('تنظيف البشرة', 'تنظيف عميق يساعد على تنقية البشرة وتحسين مظهرها واستعادة نضارتها.', 'Starting from 250 EGP', 'عناية', 0, 2),
        ('جلسات النضارة', 'جلسات مخصصة لتحسين الإشراقة والحيوية ومنح البشرة مظهرًا صحيًا متوازنًا.', 'Starting from 400 EGP', 'إشراقة', 0, 3),
        ('استشارة تجميلية', 'تقييم أولي للحالة وتحديد الجلسة أو الخطة الأنسب حسب احتياجك.', 'Book Your Visit', 'استشارة', 0, 4)
      `);
    }

    const [offersRows] = await db.execute(
      "SELECT COUNT(*) AS count FROM offers",
    );
    if (offersRows[0].count === 0) {
      await db.execute(`
        INSERT INTO offers (title, description, price, label, features, is_highlighted, sort_order)
        VALUES
        ('باقة الليزر الأساسية', 'مناسبة للبدء ومتابعة أولية بجلسات منظمة.', '999 EGP', 'Basic', 'جلسات مجدولة|متابعة أولية|استشارة مبدئية', 0, 1),
        ('باقة النضارة المميزة', 'تجربة متكاملة للعناية والإشراقة بمتابعة أدق.', '1499 EGP', 'Premium', 'جلسات نضارة|متابعة تفصيلية|ترشيحات مخصصة', 1, 2),
        ('باقة حسب احتياجك', 'ننسق لك باقة مناسبة حسب نوع الخدمة والمنطقة المطلوبة.', 'Custom Price', 'Custom', 'مرونة في الاختيار|خطة مناسبة لك|استشارة قبل الحجز', 0, 3)
      `);
    }

    console.log("✅ Database initialized successfully");
  } catch (error) {
    console.error("Database initialization error:", error);
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/* =========================
   Admin Auth
========================= */

app.post("/api/admin/login", async (req, res) => {
  try {
    const username = sanitizeText(req.body.username);
    const password = sanitizeText(req.body.password);
    const branch = sanitizeText(req.body.branch);

    if (!username || !password || !branch) {
      return res.status(400).json({
        success: false,
        message: "اسم المستخدم وكلمة المرور والفرع مطلوبين",
      });
    }

    const [rows] = await db.execute(
      "SELECT * FROM admin_users WHERE username = ? AND branch = ? LIMIT 1",
      [username, branch],
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "بيانات الدخول غير صحيحة لهذا الفرع",
      });
    }

    const admin = rows[0];
    const passwordMatch = await bcrypt.compare(password, admin.password);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "بيانات الدخول غير صحيحة لهذا الفرع",
      });
    }

    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;
    req.session.adminBranch = admin.branch;

    return res.json({
      success: true,
      message: "تم تسجيل الدخول بنجاح",
      branch: admin.branch,
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تسجيل الدخول",
    });
  }
});

app.post("/api/admin/logout", requireAdminAuth, (req, res) => {
  req.session.destroy(() => {
    return res.json({
      success: true,
      message: "تم تسجيل الخروج",
    });
  });
});

app.get("/api/admin/me", (req, res) => {
  if (req.session && req.session.adminId) {
    return res.json({
      success: true,
      authenticated: true,
      adminUsername: req.session.adminUsername,
      adminBranch: req.session.adminBranch,
    });
  }

  return res.json({
    success: true,
    authenticated: false,
  });
});

app.put("/api/admin/change-credentials", requireAdminAuth, async (req, res) => {
  try {
    const currentUsername = sanitizeText(req.body.currentUsername);
    const currentPassword = sanitizeText(req.body.currentPassword);
    const newUsername = sanitizeText(req.body.newUsername);
    const newPassword = sanitizeText(req.body.newPassword);

    if (!currentUsername || !currentPassword || !newUsername || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "من فضلك املئي كل الحقول",
      });
    }

    const [rows] = await db.execute(
      "SELECT * FROM admin_users WHERE id = ? LIMIT 1",
      [req.session.adminId],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "الأدمن غير موجود",
      });
    }

    const admin = rows[0];

    if (admin.username !== currentUsername) {
      return res.status(401).json({
        success: false,
        message: "اسم المستخدم الحالي غير صحيح",
      });
    }

    const match = await bcrypt.compare(currentPassword, admin.password);

    if (!match) {
      return res.status(401).json({
        success: false,
        message: "كلمة المرور الحالية غير صحيحة",
      });
    }

    const newHashedPassword = await bcrypt.hash(newPassword, 10);

    await db.execute(
      "UPDATE admin_users SET username = ?, password = ? WHERE id = ?",
      [newUsername, newHashedPassword, admin.id],
    );

    req.session.adminUsername = newUsername;

    return res.json({
      success: true,
      message: "تم تحديث بيانات الأدمن بنجاح",
    });
  } catch (error) {
    console.error("Change credentials error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث البيانات",
    });
  }
});

/* =========================
   Public Services & Offers
========================= */

app.get("/api/services", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM services ORDER BY sort_order ASC, id ASC",
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Fetch services error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب الخدمات",
    });
  }
});

app.get("/api/offers", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM offers ORDER BY sort_order ASC, id ASC",
    );

    return res.json({
      success: true,
      data: rows.map((item) => ({
        ...item,
        features: item.features ? item.features.split("|").filter(Boolean) : [],
      })),
    });
  } catch (error) {
    console.error("Fetch offers error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب العروض",
    });
  }
});

/* =========================
   Admin Services
========================= */

app.get("/api/admin/services", requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM services ORDER BY sort_order ASC, id ASC",
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Admin fetch services error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب الخدمات",
    });
  }
});

app.post("/api/admin/services", requireAdminAuth, async (req, res) => {
  try {
    const name = sanitizeText(req.body.name);
    const description = sanitizeText(req.body.description);
    const price = sanitizeText(req.body.price);
    const tag = sanitizeText(req.body.tag);
    const sortOrder = Number(req.body.sortOrder || 0);
    const isFeatured = req.body.isFeatured ? 1 : 0;

    if (!name || !description || !price) {
      return res.status(400).json({
        success: false,
        message: "من فضلك املئي اسم الخدمة والوصف والسعر",
      });
    }

    await db.execute(
      `INSERT INTO services (name, description, price, tag, is_featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, description, price, tag, isFeatured, sortOrder],
    );

    return res.status(201).json({
      success: true,
      message: "تمت إضافة الخدمة بنجاح",
    });
  } catch (error) {
    console.error("Create service error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إضافة الخدمة",
    });
  }
});

app.put("/api/admin/services/:id", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const name = sanitizeText(req.body.name);
    const description = sanitizeText(req.body.description);
    const price = sanitizeText(req.body.price);
    const tag = sanitizeText(req.body.tag);
    const sortOrder = Number(req.body.sortOrder || 0);
    const isFeatured = req.body.isFeatured ? 1 : 0;

    if (!name || !description || !price) {
      return res.status(400).json({
        success: false,
        message: "من فضلك املئي اسم الخدمة والوصف والسعر",
      });
    }

    await db.execute(
      `UPDATE services
       SET name = ?, description = ?, price = ?, tag = ?, is_featured = ?, sort_order = ?
       WHERE id = ?`,
      [name, description, price, tag, isFeatured, sortOrder, id],
    );

    return res.json({
      success: true,
      message: "تم تحديث الخدمة بنجاح",
    });
  } catch (error) {
    console.error("Update service error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث الخدمة",
    });
  }
});

app.delete("/api/admin/services/:id", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute("DELETE FROM services WHERE id = ?", [id]);

    return res.json({
      success: true,
      message: "تم حذف الخدمة",
    });
  } catch (error) {
    console.error("Delete service error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف الخدمة",
    });
  }
});

/* =========================
   Admin Offers
========================= */

app.get("/api/admin/offers", requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM offers ORDER BY sort_order ASC, id ASC",
    );

    return res.json({
      success: true,
      data: rows.map((item) => ({
        ...item,
        features: item.features ? item.features.split("|").filter(Boolean) : [],
      })),
    });
  } catch (error) {
    console.error("Admin fetch offers error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب العروض",
    });
  }
});

app.post("/api/admin/offers", requireAdminAuth, async (req, res) => {
  try {
    const title = sanitizeText(req.body.title);
    const description = sanitizeText(req.body.description);
    const price = sanitizeText(req.body.price);
    const label = sanitizeText(req.body.label);
    const features = Array.isArray(req.body.features)
      ? req.body.features.join("|")
      : sanitizeText(req.body.features);
    const sortOrder = Number(req.body.sortOrder || 0);
    const isHighlighted = req.body.isHighlighted ? 1 : 0;

    if (!title || !description || !price) {
      return res.status(400).json({
        success: false,
        message: "من فضلك املئي عنوان العرض والوصف والسعر",
      });
    }

    await db.execute(
      `INSERT INTO offers (title, description, price, label, features, is_highlighted, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, description, price, label, features, isHighlighted, sortOrder],
    );

    return res.status(201).json({
      success: true,
      message: "تمت إضافة العرض بنجاح",
    });
  } catch (error) {
    console.error("Create offer error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إضافة العرض",
    });
  }
});

app.put("/api/admin/offers/:id", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const title = sanitizeText(req.body.title);
    const description = sanitizeText(req.body.description);
    const price = sanitizeText(req.body.price);
    const label = sanitizeText(req.body.label);
    const features = Array.isArray(req.body.features)
      ? req.body.features.join("|")
      : sanitizeText(req.body.features);
    const sortOrder = Number(req.body.sortOrder || 0);
    const isHighlighted = req.body.isHighlighted ? 1 : 0;

    if (!title || !description || !price) {
      return res.status(400).json({
        success: false,
        message: "من فضلك املئي عنوان العرض والوصف والسعر",
      });
    }

    await db.execute(
      `UPDATE offers
       SET title = ?, description = ?, price = ?, label = ?, features = ?, is_highlighted = ?, sort_order = ?
       WHERE id = ?`,
      [
        title,
        description,
        price,
        label,
        features,
        isHighlighted,
        sortOrder,
        id,
      ],
    );

    return res.json({
      success: true,
      message: "تم تحديث العرض بنجاح",
    });
  } catch (error) {
    console.error("Update offer error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث العرض",
    });
  }
});

app.delete("/api/admin/offers/:id", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute("DELETE FROM offers WHERE id = ?", [id]);

    return res.json({
      success: true,
      message: "تم حذف العرض",
    });
  } catch (error) {
    console.error("Delete offer error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف العرض",
    });
  }
});

/* =========================
   Available Slots
========================= */

app.get("/api/available-slots", async (req, res) => {
  try {
    const branch = sanitizeText(req.query.branch);
    const slotDate = sanitizeText(req.query.date);

    if (!branch || !slotDate) {
      return res.status(400).json({
        success: false,
        message: "الفرع والتاريخ مطلوبان",
      });
    }

    if (!ALLOWED_BRANCHES.includes(branch)) {
      return res.status(400).json({
        success: false,
        message: "الفرع غير صحيح",
      });
    }

    const allSlots = generateTimeSlots(branch);

    const [bookedRows] = await db.execute(
      `SELECT preferred_time
       FROM bookings
       WHERE branch = ?
       AND preferred_date = ?
       AND status NOT IN ('ملغي', 'تم الإلغاء', 'تأجيل')`,
      [branch, slotDate],
    );

    const bookedTimes = bookedRows.map((r) =>
      String(r.preferred_time || "").slice(0, 5),
    );

    const available = allSlots
      .filter((time) => !bookedTimes.includes(time))
      .map((time) => ({
        id: time,
        slot_time: time,
      }));

    return res.json({
      success: true,
      data: available,
    });
  } catch (error) {
    console.error("Fetch available slots error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب المواعيد المتاحة",
    });
  }
});

app.get("/api/admin/slots", requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT *
       FROM available_slots
       WHERE branch = ?
       ORDER BY slot_date ASC, slot_time ASC`,
      [req.adminBranch],
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Fetch admin slots error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب المواعيد",
    });
  }
});

app.post("/api/admin/slots", requireAdminAuth, async (req, res) => {
  try {
    const slotDate = sanitizeText(req.body.slotDate);
    const slotTime = sanitizeText(req.body.slotTime);
    const branch = req.adminBranch;

    if (!slotDate || !slotTime) {
      return res.status(400).json({
        success: false,
        message: "من فضلك اختاري التاريخ والوقت",
      });
    }

    const [existing] = await db.execute(
      `SELECT id
       FROM available_slots
       WHERE branch = ? AND slot_date = ? AND slot_time = ?
       LIMIT 1`,
      [branch, slotDate, slotTime],
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "هذا الموعد موجود بالفعل",
      });
    }

    await db.execute(
      `INSERT INTO available_slots (branch, slot_date, slot_time, is_booked)
       VALUES (?, ?, ?, 0)`,
      [branch, slotDate, slotTime],
    );

    return res.status(201).json({
      success: true,
      message: "تمت إضافة الموعد المتاح",
    });
  } catch (error) {
    console.error("Create slot error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إضافة الموعد",
    });
  }
});

app.delete("/api/admin/slots/:id", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(
      "SELECT * FROM available_slots WHERE id = ? AND branch = ? LIMIT 1",
      [id, req.adminBranch],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "الموعد غير موجود",
      });
    }

    if (Number(rows[0].is_booked) === 1 && rows[0].booking_id) {
      await db.execute(
        "UPDATE bookings SET preferred_date = NULL, preferred_time = NULL WHERE id = ?",
        [rows[0].booking_id],
      );
    }

    await db.execute(
      "DELETE FROM available_slots WHERE id = ? AND branch = ?",
      [id, req.adminBranch],
    );

    return res.json({
      success: true,
      message: "تم حذف الموعد",
    });
  } catch (error) {
    console.error("Delete slot error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف الموعد",
    });
  }
});

/* =========================
   Admin Direct Booking (no slot required)
========================= */

app.post("/api/admin/bookings", requireAdminAuth, async (req, res) => {
  try {
    const fullName = sanitizeText(req.body.fullName);
    const phone = sanitizeText(req.body.phone);
    const age = req.body.age ? Number(req.body.age) : null;
    const service = sanitizeText(req.body.service);
    const bodyArea = sanitizeText(req.body.bodyArea);
    const preferredDate = sanitizeText(req.body.preferredDate);
    const preferredTime = sanitizeText(req.body.preferredTime);
    const sessionType = sanitizeText(req.body.sessionType);
    const contactMethod = sanitizeText(req.body.contactMethod);
    const medicalNotes = sanitizeText(req.body.medicalNotes);
    const status = sanitizeText(req.body.status) || "حجز جديد";
    const branch = req.adminBranch;

    const ALLOWED_STATUSES = [
      "حجز جديد",
      "تم التأكيد",
      "تم الحضور",
      "مكتمل",
      "غياب",
      "ملغي",
      "تأجيل",
    ];

    if (!fullName || fullName.length < 2) {
      return res.status(400).json({ success: false, message: "الاسم مطلوب" });
    }
    if (!phone || !isValidPhone(phone)) {
      return res
        .status(400)
        .json({ success: false, message: "رقم الهاتف غير صحيح" });
    }
    if (!preferredDate) {
      return res.status(400).json({ success: false, message: "التاريخ مطلوب" });
    }
    if (!ALLOWED_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "الحالة غير صحيحة" });
    }

    const [result] = await db.execute(
      `INSERT INTO bookings
       (full_name, phone, branch, age, service, body_area, preferred_date, preferred_time, session_type, contact_method, medical_notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullName,
        phone,
        branch,
        age,
        service || null,
        bodyArea || null,
        preferredDate,
        preferredTime || null,
        sessionType || null,
        contactMethod || null,
        medicalNotes || null,
        status,
      ],
    );

    appendToSheet(
      [
        result.insertId,
        fullName,
        phone,
        branch,
        age || "",
        service || "",
        bodyArea || "",
        preferredDate,
        preferredTime || "",
        sessionType || "",
        contactMethod || "",
        status,
        medicalNotes || "",
        new Date().toISOString().slice(0, 10),
      ],
      branch,
    );

    return res
      .status(201)
      .json({
        success: true,
        message: "تم حفظ الحجز بنجاح",
        bookingId: result.insertId,
      });
  } catch (error) {
    console.error("Admin create booking error:", error);
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء الحفظ" });
  }
});

/* =========================
   Bookings
========================= */

app.post("/api/bookings", async (req, res) => {
  try {
    const fullName = sanitizeText(req.body.fullName);
    const phone = sanitizeText(req.body.phone);
    const branch = sanitizeText(req.body.branch);
    const preferredDate = sanitizeText(req.body.preferredDate);
    const selectedTime = sanitizeText(
      req.body.slotId || req.body.preferredTime,
    );
    const age = req.body.age ? Number(req.body.age) : null;
    const service = sanitizeText(req.body.service);
    const bodyArea = sanitizeText(req.body.bodyArea);
    const sessionType = sanitizeText(req.body.sessionType);
    const contactMethod = sanitizeText(req.body.contactMethod);
    const medicalNotes = sanitizeText(req.body.medicalNotes);

    if (!fullName || fullName.length < 3) {
      return res.status(400).json({
        success: false,
        message: "الاسم يجب أن يكون 3 أحرف على الأقل",
      });
    }

    if (!phone || !isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "رقم الهاتف غير صحيح",
      });
    }

    if (!ALLOWED_BRANCHES.includes(branch)) {
      return res.status(400).json({
        success: false,
        message: "من فضلك اختاري الفرع",
      });
    }

    if (!preferredDate) {
      return res.status(400).json({
        success: false,
        message: "من فضلك اختاري اليوم",
      });
    }

    if (!selectedTime) {
      return res.status(400).json({
        success: false,
        message: "من فضلك اختاري الموعد المتاح",
      });
    }

    if (!service) {
      return res.status(400).json({
        success: false,
        message: "من فضلك اختاري الخدمة",
      });
    }

    if (age !== null && (Number.isNaN(age) || age < 10 || age > 80)) {
      return res.status(400).json({
        success: false,
        message: "العمر غير صحيح",
      });
    }

    const timeShort = selectedTime.slice(0, 5);
    const allSlots = generateTimeSlots(branch);

    if (!allSlots.includes(timeShort)) {
      return res.status(400).json({
        success: false,
        message: "هذا الموعد خارج ساعات العمل",
      });
    }

    const [conflict] = await db.execute(
      `SELECT id FROM bookings
       WHERE branch = ?
       AND preferred_date = ?
       AND preferred_time = ?
       AND status NOT IN ('ملغي', 'تم الإلغاء', 'تأجيل')
       LIMIT 1`,
      [branch, preferredDate, timeShort],
    );

    if (conflict.length > 0) {
      return res.status(400).json({
        success: false,
        message: "هذا الموعد تم حجزه بالفعل، من فضلك اختاري موعد آخر",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO bookings
      (
        full_name,
        phone,
        branch,
        age,
        service,
        body_area,
        preferred_date,
        preferred_time,
        session_type,
        contact_method,
        medical_notes,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullName,
        phone,
        branch,
        age,
        service,
        bodyArea || null,
        preferredDate,
        timeShort,
        sessionType || null,
        contactMethod || null,
        medicalNotes || null,
        "طلب جديد",
      ],
    );

    appendToSheet(
      [
        result.insertId,
        fullName,
        phone,
        branch,
        age || "",
        service,
        bodyArea || "",
        preferredDate,
        timeShort,
        sessionType || "",
        contactMethod || "",
        "طلب جديد",
        medicalNotes || "",
        new Date().toISOString().slice(0, 10),
      ],
      branch,
    );

    return res.status(201).json({
      success: true,
      message: "تم إرسال طلب الحجز بنجاح ✅ سيتم التواصل معك لتأكيد المعاد",
      bookingId: result.insertId,
    });
  } catch (error) {
    console.error("Create booking error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حفظ الحجز",
    });
  }
});

app.get("/api/bookings", requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM bookings WHERE branch = ? ORDER BY id DESC",
      [req.adminBranch],
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Fetch bookings error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب الحجوزات",
    });
  }
});

app.patch("/api/bookings/:id/status", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const status = sanitizeText(req.body.status);

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "الحالة مطلوبة",
      });
    }

    const [rows] = await db.execute(
      "SELECT * FROM bookings WHERE id = ? AND branch = ? LIMIT 1",
      [id, req.adminBranch],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "الحجز غير موجود",
      });
    }

    await db.execute(
      "UPDATE bookings SET status = ? WHERE id = ? AND branch = ?",
      [status, id, req.adminBranch],
    );

    updateSheetRow(id, status, rows[0].branch);

    return res.json({
      success: true,
      message: "تم تحديث حالة الحجز",
    });
  } catch (error) {
    console.error("Update booking status error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث الحالة",
    });
  }
});

app.delete("/api/bookings/:id", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute("DELETE FROM bookings WHERE id = ? AND branch = ?", [
      id,
      req.adminBranch,
    ]);

    return res.json({
      success: true,
      message: "تم حذف الحجز",
    });
  } catch (error) {
    console.error("Delete booking error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف الحجز",
    });
  }
});

/* =========================
   Finances
========================= */

app.post("/api/finances", requireAdminAuth, async (req, res) => {
  try {
    const financeDate = sanitizeText(req.body.financeDate);
    const clientName = sanitizeText(req.body.clientName);
    const serviceArea = sanitizeText(req.body.serviceArea);
    const totalAmount = Number(req.body.totalAmount || 0);
    const paidAmount = Number(req.body.paidAmount || 0);
    const remainingAmount = Number(
      req.body.remainingAmount !== undefined
        ? req.body.remainingAmount
        : totalAmount - paidAmount,
    );
    const paymentMethod = sanitizeText(req.body.paymentMethod) || "كاش";
    const notes = sanitizeText(req.body.notes);
    const branch = req.adminBranch;

    if (!clientName || clientName.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "اسم العميل غير صحيح" });
    }

    if ([totalAmount, paidAmount].some(Number.isNaN)) {
      return res
        .status(400)
        .json({ success: false, message: "قيم الحسابات غير صحيحة" });
    }

    await db.execute(
      `INSERT INTO finances (branch, finance_date, client_name, service_area, total_amount, paid_amount, remaining_amount, payment_method, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        branch,
        financeDate || null,
        clientName,
        serviceArea || null,
        totalAmount,
        paidAmount,
        Math.max(remainingAmount, 0),
        paymentMethod,
        notes || null,
      ],
    );

    return res
      .status(201)
      .json({ success: true, message: "تم حفظ الحساب بنجاح" });
  } catch (error) {
    console.error("Create finance error:", error);
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء حفظ الحساب" });
  }
});

app.get("/api/finances", requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM finances WHERE branch = ? OR branch IS NULL ORDER BY finance_date DESC, id DESC",
      [req.adminBranch],
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Fetch finances error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب الحسابات",
    });
  }
});

app.delete("/api/finances/:id", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute("DELETE FROM finances WHERE id = ?", [id]);

    return res.json({
      success: true,
      message: "تم حذف الحساب",
    });
  } catch (error) {
    console.error("Delete finance error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف الحساب",
    });
  }
});

/* =========================
   Session Operations
========================= */

app.get("/api/admin/session-operations", requireAdminAuth, async (req, res) => {
  try {
    const daysFilter = req.query.days ? Number(req.query.days) : null;
    let sql = `SELECT * FROM session_operations WHERE branch = ?`;
    const params = [req.adminBranch];
    if (daysFilter && !isNaN(daysFilter)) {
      sql += ` AND DATEDIFF(CURDATE(), operation_date) >= ?`;
      params.push(daysFilter);
    }
    sql += ` ORDER BY operation_date DESC`;
    const [rows] = await db.execute(sql, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("session-operations GET error:", err);
    return res.status(500).json({ success: false, message: "حدث خطأ" });
  }
});

app.post(
  "/api/admin/session-operations",
  requireAdminAuth,
  async (req, res) => {
    try {
      const clientName = sanitizeText(req.body.clientName);
      const phone = sanitizeText(req.body.phone);
      const service = sanitizeText(req.body.service);
      const bodyArea = sanitizeText(req.body.bodyArea);
      const operationDate = sanitizeText(req.body.operationDate);
      const notes = sanitizeText(req.body.notes);
      const branch = req.adminBranch;

      if (!clientName || clientName.length < 2) {
        return res.status(400).json({ success: false, message: "الاسم مطلوب" });
      }
      if (!operationDate) {
        return res
          .status(400)
          .json({ success: false, message: "تاريخ العملية مطلوب" });
      }

      await db.execute(
        `INSERT INTO session_operations (branch, client_name, phone, service, body_area, operation_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          branch,
          clientName,
          phone || null,
          service || null,
          bodyArea || null,
          operationDate,
          notes || null,
        ],
      );

      return res
        .status(201)
        .json({ success: true, message: "تمت إضافة العملية بنجاح" });
    } catch (err) {
      console.error("session-operations POST error:", err);
      return res.status(500).json({ success: false, message: "حدث خطأ" });
    }
  },
);

app.delete(
  "/api/admin/session-operations/:id",
  requireAdminAuth,
  async (req, res) => {
    try {
      await db.execute(
        "DELETE FROM session_operations WHERE id = ? AND branch = ?",
        [req.params.id, req.adminBranch],
      );
      return res.json({ success: true, message: "تم الحذف" });
    } catch (err) {
      return res.status(500).json({ success: false, message: "حدث خطأ" });
    }
  },
);

/* =========================
   Manual Send + Extra Contacts APIs
========================= */

app.post(
  "/api/admin/reminders/manual-send",
  requireAdminAuth,
  async (req, res) => {
    try {
      const branch = req.adminBranch;
      const { targets, message } = req.body;
      if (!targets || !Array.isArray(targets) || targets.length === 0)
        return res
          .status(400)
          .json({ success: false, message: "لا توجد عميلات مختارة" });
      if (!message || message.trim().length < 2)
        return res
          .status(400)
          .json({ success: false, message: "الرسالة فارغة" });
      let sent = 0,
        failed = 0;
      for (const t of targets) {
        const msg = message
          .replace(/{name}/g, t.name || "")
          .replace(/{phone}/g, t.phone || "");
        const ok = await sendWhatsAppMessage(t.phone, msg, branch);
        if (ok) sent++;
        else failed++;
        await new Promise((r) => setTimeout(r, 700));
      }
      return res.json({ success: true, sent, failed });
    } catch (err) {
      console.error("Manual send error:", err);
      return res.status(500).json({ success: false, message: "حدث خطأ" });
    }
  },
);

app.get("/api/admin/extra-contacts", requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM extra_contacts WHERE branch = ? ORDER BY created_at DESC",
      [req.adminBranch],
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "حدث خطأ" });
  }
});

app.post("/api/admin/extra-contacts", requireAdminAuth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone)
      return res
        .status(400)
        .json({ success: false, message: "الاسم والهاتف مطلوبين" });
    await db.execute(
      "INSERT INTO extra_contacts (branch, name, phone) VALUES (?, ?, ?)",
      [req.adminBranch, name.trim(), phone.trim()],
    );
    return res.json({ success: true, message: "تمت الإضافة" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "حدث خطأ" });
  }
});

app.delete(
  "/api/admin/extra-contacts/:id",
  requireAdminAuth,
  async (req, res) => {
    try {
      await db.execute(
        "DELETE FROM extra_contacts WHERE id = ? AND branch = ?",
        [req.params.id, req.adminBranch],
      );
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, message: "حدث خطأ" });
    }
  },
);

/* =========================
   Reminder Settings
========================= */

app.get("/api/admin/reminders", requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM reminder_settings WHERE branch = ? LIMIT 1",
      [req.adminBranch],
    );
    return res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    console.error("Get reminders error:", err);
    return res.status(500).json({ success: false, message: "حدث خطأ" });
  }
});

app.put("/api/admin/reminders", requireAdminAuth, async (req, res) => {
  try {
    const daysAfter = Number(req.body.daysAfter);
    const sendTime = (req.body.sendTime || "09:00").slice(0, 5);
    const messageTemplate = sanitizeText(req.body.messageTemplate);
    const isActive = req.body.isActive ? 1 : 0;

    if (!messageTemplate || messageTemplate.length < 10) {
      return res
        .status(400)
        .json({ success: false, message: "نص الرسالة قصير جداً" });
    }
    if (isNaN(daysAfter) || daysAfter < 1 || daysAfter > 365) {
      return res
        .status(400)
        .json({ success: false, message: "عدد الأيام غير صحيح (1-365)" });
    }

    await db.execute(
      `INSERT INTO reminder_settings (branch, days_after, send_time, message_template, is_active)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         days_after = VALUES(days_after),
         send_time = VALUES(send_time),
         message_template = VALUES(message_template),
         is_active = VALUES(is_active)`,
      [req.adminBranch, daysAfter, sendTime, messageTemplate, isActive],
    );

    return res.json({ success: true, message: "تم حفظ إعدادات التذكير" });
  } catch (err) {
    console.error("Update reminders error:", err);
    return res.status(500).json({ success: false, message: "حدث خطأ" });
  }
});

app.get("/api/admin/reminders/due", requireAdminAuth, async (req, res) => {
  try {
    const [settingsRows] = await db.execute(
      "SELECT * FROM reminder_settings WHERE branch = ? AND is_active = 1 LIMIT 1",
      [req.adminBranch],
    );

    if (settingsRows.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: "التذكير غير مفعّل",
      });
    }

    const settings = settingsRows[0];
    const daysAfter = settings.days_after;

    const [rows] = await db.execute(
      `SELECT b.id, b.full_name, b.phone, b.service, b.body_area,
              b.preferred_date, b.preferred_time, b.status
       FROM bookings b
       WHERE b.branch = ?
         AND b.status IN ('مكتمل', 'تم التأكيد')
         AND DATE(b.preferred_date) = DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY b.preferred_date DESC`,
      [req.adminBranch, daysAfter],
    );

    return res.json({
      success: true,
      data: rows,
      template: settings.message_template,
      daysAfter,
    });
  } catch (err) {
    console.error("Get due reminders error:", err);
    return res.status(500).json({ success: false, message: "حدث خطأ" });
  }
});

/* =========================
   Reminder Logs (سجل الرسائل المبعوتة)
========================= */

app.get("/api/admin/reminders/logs", requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT * FROM reminder_logs
       WHERE branch = ?
       ORDER BY sent_at DESC
       LIMIT 100`,
      [req.adminBranch],
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Reminder logs error:", err);
    return res.status(500).json({ success: false, message: "حدث خطأ" });
  }
});

app.post("/api/admin/reminders/run-now", requireAdminAuth, async (req, res) => {
  try {
    const branch = req.adminBranch;
    const [sRows] = await db.execute(
      "SELECT * FROM reminder_settings WHERE branch = ? AND is_active = 1 LIMIT 1",
      [branch],
    );
    if (sRows.length === 0) {
      return res.json({
        success: false,
        message: "التذكير غير مفعّل لهذا الفرع",
      });
    }
    const settings = sRows[0];
    const [clients] = await db.execute(
      `SELECT b.id, b.full_name, b.phone, b.service, b.body_area, b.preferred_date
       FROM bookings b
       WHERE b.branch = ?
         AND b.status IN ('مكتمل', 'تم التأكيد', 'تم الحضور')
         AND DATE(b.preferred_date) = DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [branch, settings.days_after],
    );

    if (clients.length === 0) {
      return res.json({
        success: true,
        message: "لا توجد عميلات مستحقة اليوم",
        sent: 0,
      });
    }

    let sent = 0;
    for (const client of clients) {
      const [already] = await db.execute(
        "SELECT id FROM reminder_logs WHERE booking_id = ? AND status = 'sent' LIMIT 1",
        [client.id],
      );
      if (already.length > 0) continue;

      const dateStr = client.preferred_date
        ? String(client.preferred_date).slice(0, 10)
        : "";
      const message = settings.message_template
        .replace(/{name}/g, client.full_name || "")
        .replace(/{service}/g, client.service || "")
        .replace(/{area}/g, client.body_area || "")
        .replace(/{date}/g, dateStr);

      const ok = await sendWhatsAppMessage(client.phone, message, branch);
      await db.execute(
        `INSERT INTO reminder_logs (booking_id, branch, phone, full_name, sent_at, status)
         VALUES (?, ?, ?, ?, NOW(), ?)`,
        [
          client.id,
          branch,
          client.phone,
          client.full_name,
          ok ? "sent" : "failed",
        ],
      );
      if (ok) sent++;
      await new Promise((r) => setTimeout(r, 1000));
    }

    return res.json({
      success: true,
      message: `تم إرسال ${sent} رسالة من أصل ${clients.length} عميلة`,
      sent,
      total: clients.length,
    });
  } catch (err) {
    console.error("Run reminders now error:", err);
    return res.status(500).json({ success: false, message: "حدث خطأ" });
  }
});

/* =========================
   Start
========================= */

const PORT = process.env.PORT || 3000;

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);

    const creds = getGoogleCredentials();
    if (creds) {
      console.log(`✅ Google Sheets: جاهز`);
      console.log(`   Service Account: ${creds.client_email}`);
      console.log(`   فرع العبور   → ${BRANCH_SHEET_IDS["فرع العبور"]}`);
      console.log(`   فرع ميت غمر → ${BRANCH_SHEET_IDS["فرع ميت غمر"]}`);
      console.log(`   فرع المنيا  → ${BRANCH_SHEET_IDS["فرع المنيا"]}`);
    } else {
      console.warn(
        "⚠️  Google Sheets: غير مفعّل - الحجوزات ستُحفظ في قاعدة البيانات فقط",
      );
    }

    startReminderCron();
  });
});

(async () => {
  try {
    await db.execute(`
      ALTER TABLE available_slots
      ADD COLUMN booking_id INT NULL
    `);
  } catch (_) {}
})();
