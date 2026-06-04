const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const OpenAI = require("openai");
const app = express();

const connectionString = "postgresql://neondb_owner:npg_DPrAdCa7W4HZ@ep-dawn-shape-a4im99ti-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // Forces a secure SSL handshake layout
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS  
    },
    tls: {
        // Prevents Render from failing authentication on random cloud networks
        rejectUnauthorized: false
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(
  express.static(
    path.join(__dirname, "RECYCONNECT")
  )
);

// Point calculation
const pointsPerKg = {
  "Plastic Bottles": 10,
  "Paper / Cardboard": 10,
  "E-Waste": 20,
  "Metal Cans": 15,
  "Biodegradable Substance": 12,
};

// Initialize database
async function initializeDatabase() {
  try {
    console.log("⏳ Attempting to connect to Neon Database...");
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        points INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS waste_submissions (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        waste_type VARCHAR(100),
        weight DECIMAL(10, 2),
        address TEXT,
        pickup_date DATE,
        points_earned INT,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS redemptions (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        reward_type VARCHAR(255),
        points_used INT,
        status VARCHAR(50) DEFAULT 'Completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ SUCCESS: Database Connected and Tables Created!");
  } catch (err) {
    console.error("❌ Database initialization error:", err);
  }
}

initializeDatabase();

// --- API Routes ---

const getCurrentUser = async (email) => {
  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1 ORDER BY created_at DESC LIMIT 1",
    [email]
  );
  return result.rows[0] || null;
};

// REGISTER
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, password, points) VALUES ($1, $2, $3, 0) RETURNING id, name, email, points",
      [name, email, hashedPassword]
    );
    res.json({ message: "Registration successful", user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// LOGIN
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await getCurrentUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "Invalid password" });

    res.json({ message: "Login successful", user: { name: user.name, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// RESET PASSWORD
app.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ error: "Missing fields" });

    const user = await getCurrentUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [hashedPassword, email]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// CHATBOT
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const lowerMsg = message ? message.toLowerCase() : "";
    
    let botMessage = "I'm not sure about that, but try asking about 'plastic', 'paper', 'points', or 'rewards'!";

    if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
      botMessage = "Hello! I am RecyBot. Ask me about recycling rates or how to earn points.";
    } 
    else if (lowerMsg.includes("plastic") || lowerMsg.includes("bottle")) {
      botMessage = "Plastic bottles are highly recyclable! You earn 10 Points per kg for clean plastic bottles. Please remove the caps before submitting.";
    }
    else if (lowerMsg.includes("paper") || lowerMsg.includes("cardboard")) {
      botMessage = "Paper and cardboard are great! You earn 10 Points per kg. Make sure they are dry and flattened.";
    }
    else if (lowerMsg.includes("ewaste") || lowerMsg.includes("electronic") || lowerMsg.includes("e-waste")) {
      botMessage = "E-Waste is valuable! You get 20 Points per kg for old electronics. Do not dispose of batteries in regular trash.";
    }
    else if (lowerMsg.includes("metal") || lowerMsg.includes("can")) {
      botMessage = "Metal cans earn 15 Points per kg. Aluminum cans are 100% recyclable!";
    }
    else if (lowerMsg.includes("point") || lowerMsg.includes("score")) {
      botMessage = "You earn points based on weight! Plastic/Paper = 10pts, E-Waste = 20pts. Check your Dashboard to see your balance.";
    }
    else if (lowerMsg.includes("thank")) {
      botMessage = "You're welcome! Keep recycling to save the planet! 🌍";
    }

    setTimeout(() => {
        res.json({ reply: botMessage });
    }, 500);

  } catch (err) {
    res.status(400).json({ error: "Failed to process message" });
  }
});

// SUBMIT WASTE
app.post("/submit-waste", async (req, res) => {
  try {
    const { email, wasteType, weight, address, pickupDate } = req.body;
    console.log(`📥 Incoming waste submission request received for email account: ${email}`);
    
    if (!email || !wasteType || !weight || !address || !pickupDate) {
      return res.status(400).json({ error: "Missing required submission fields" });
    }

    const user = await getCurrentUser(email);
    if (!user) {
      console.log(`⚠️ Submission failed: No account exists for email: ${email}`);
      return res.status(404).json({ error: "User account not found" });
    }

    const pointsPerKgValue = pointsPerKg[wasteType] || 10;
    const pointsEarned = Math.round(parseFloat(weight) * pointsPerKgValue);

    const insertQuery = `
      INSERT INTO waste_submissions (user_id, waste_type, weight, address, pickup_date, points_earned, status) 
      VALUES ($1, $2, $3, $4, $5, $6, 'Pending') 
      RETURNING *;
    `;
    const result = await pool.query(insertQuery, [
      user.id, 
      wasteType, 
      parseFloat(weight), 
      address, 
      pickupDate, 
      pointsEarned
    ]);

    await pool.query("UPDATE users SET points = points + $1 WHERE id = $2", [pointsEarned, user.id]);
    console.log(`✅ Success: Submission stored for user ID ${user.id} (${email}). Earned ${pointsEarned} pts.`);

    return res.status(201).json({ 
      success: true,
      message: "Waste request successfully logged!", 
      submission: result.rows[0], 
      pointsEarned 
    });

  } catch (err) {
    console.error("❌ Submission Engine Failure:", err);
    return res.status(500).json({ error: "Internal database write breakdown." });
  }
});

// POST: REDEEM REWARD
app.post("/redeem-reward", async (req, res) => {
  try {
    const { email, rewardName, pointsCost } = req.body;
    const sanitizedEmail = email ? email.trim().toLowerCase() : "";
    const cleanPointsCost = parseInt(pointsCost);

    console.log(`📥 Processing redemption: ${sanitizedEmail} trying to claim '${rewardName}' for ${cleanPointsCost} pts`);

    const userResult = await pool.query(
      "SELECT name, points FROM users WHERE LOWER(email) = $1", 
      [sanitizedEmail]
    );

    if (userResult.rows.length === 0) {
      console.log(`⚠️ Balance Denied: No account row found matching email: "${sanitizedEmail}"`);
      return res.status(404).json({ error: "User profile not found in system storage." });
    }

    const databasePoints = parseInt(userResult.rows[0].points || 0);
    const userName = userResult.rows[0].name || "Eco Recycler";

    if (databasePoints < cleanPointsCost) {
      console.log(`⚠️ Balance Denied: User has ${databasePoints} pts, but item costs ${cleanPointsCost} pts.`);
      return res.status(400).json({ error: "Insufficient points balance." });
    }

    await pool.query(
      "UPDATE users SET points = points - $1 WHERE LOWER(email) = $2",
      [cleanPointsCost, sanitizedEmail]
    );

    console.log(`✅ Database Updated: Successfully subtracted ${cleanPointsCost} points from ${sanitizedEmail}`);
    const dynamicCouponCode = "RC-" + Math.random().toString(36).substr(2, 9).toUpperCase();

    // ⚡ BYPASS MECHANISM: Dispatch the mobile app's success payload status immediately to drop the loading screen.
    // The asynchronous email task executes independently in the background.
    res.status(200).json({ success: true, message: "Redeemed successfully!", code: dynamicCouponCode });

    // Background asynchronous network handshake handler
    transporter.sendMail({
      from: '"RecyConnect Rewards" <officialrecyconnect@gmail.com>',
      to: sanitizedEmail,
      subject: `🎁 Your ${rewardName} Code is Ready!`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 25px; max-width: 500px; border: 2px solid #3FA34D; border-radius: 15px; margin: 0 auto;">
          <h2 style="color: #3FA34D; text-align: center;">🎉 Reward Unlocked! 🎉</h2>
          <p>Dear <b>${userName}</b>,</p>
          <p>You have successfully redeemed <b>${cleanPointsCost} Eco Points</b> for:</p>
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 10px; text-align: center; margin: 20px 0; border: 1px dashed #3FA34D;">
            <span style="font-size: 16px; color: #666; text-transform: uppercase;"><b>${rewardName}</b></span><br/>
            <span style="font-size: 26px; color: #D9A514; letter-spacing: 2px; display: block; margin-top: 5px;"><b>${dynamicCouponCode}</b></span>
          </div>
          <p style="text-align: center; color: #888; font-size: 12px;">© 2026 RecyConnect Ecosystem</p>
        </div>
      `
    }, (mailerError, info) => {
        if (mailerError) {
            console.error("❌ NODEMAILER ASYNC SLOW HANDSHAKE DROP (Cloud IP Blocked by Google Security):", mailerError.message);
        } else {
            console.log(`✉️ Email Dispatched successfully to network gateway: ${sanitizedEmail}`);
        }
    });

  } catch (err) {
    console.error("❌ CRITICAL REDEMPTION CRASH FAILURE:", err);
    if (!res.headersSent) {
        return res.status(500).json({ error: "Internal server error during processing engine loop." });
    }
  }
});

// REDEEM OLD
app.post("/redeem", async (req, res) => {
  try {
    const { email, rewardType, pointsRequired } = req.body;
    const user = await getCurrentUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.points < pointsRequired) return res.status(400).json({ error: "Insufficient points" });

    const result = await pool.query(
      "INSERT INTO redemptions (user_id, reward_type, points_used, status) VALUES ($1, $2, $3, 'Completed') RETURNING *",
      [user.id, rewardType, pointsRequired]
    );

    await pool.query("UPDATE users SET points = points - $1 WHERE id = $2", [pointsRequired, user.id]);
    res.json({ message: "Reward redeemed", redemption: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET USER
app.get("/user/:email", async (req, res) => {
  try {
    const user = await getCurrentUser(req.params.email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const activity = await pool.query(
      `SELECT waste_type, weight, points_earned, status, created_at FROM waste_submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [user.id]
    );
    
    const stats = await pool.query(
      `SELECT SUM(weight) as total_weight, SUM(points_earned) as total_points FROM waste_submissions WHERE user_id = $1`,
      [user.id]
    );

    res.json({
      user: {
        name: user.name,
        email: user.email,
        points: user.points,
        totalRecycled: stats.rows[0].total_weight || 0,
      },
      activity: activity.rows,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ADMIN - GET ALL WASTE REQUESTS
app.get("/admin/requests", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        waste_submissions.id,
        users.name,
        users.email,
        waste_submissions.waste_type,
        waste_submissions.weight,
        waste_submissions.address,
        waste_submissions.pickup_date,
        waste_submissions.points_earned,
        waste_submissions.status
      FROM waste_submissions
      JOIN users ON users.id = waste_submissions.user_id
      ORDER BY waste_submissions.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADMIN UPDATE STATUS
app.put("/admin/update-status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await pool.query(
      "UPDATE waste_submissions SET status = $1 WHERE id = $2",
      [status, id]
    );

    const result = await pool.query(`
      SELECT
        users.name,
        users.email,
        waste_submissions.waste_type,
        waste_submissions.weight
      FROM waste_submissions
      JOIN users ON users.id = waste_submissions.user_id
      WHERE waste_submissions.id = $1
    `, [id]);

    const user = result.rows[0];

    if (!user || !user.email) {
      console.log(`⚠️ Warning: Mail skipped. No valid user account found linked to submission ID: ${id}`);
      return res.json({ success: true, message: "Status updated, but no email sent (User profile missing)" });
    }

    console.log(`✉️ Attempting to dispatch alert notification to target email inbox: ${user.email}`);

    // ⚡ BYPASS MECHANISM: Close out the HTTP request transaction context instantly so the admin interface updates seamlessly.
    res.json({ success: true, message: "Status updated successfully" });

    // Background network transport executor
    if (status.toLowerCase() === "approved") {
      transporter.sendMail({
        from: '"RecyConnect Team" <officialrecyconnect@gmail.com>', 
        to: user.email.trim(), 
        subject: "♻️ RecyConnect Request Approved",
        html: `
          <div style="font-family:Arial; padding:20px; line-height:1.8;">
            <h2 style="color:green;">🌱 Request Approved Successfully</h2>
            <p>Dear <b>${user.name}</b>,</p>
            <p>Your recycling request has been approved.</p>
            <p>📦 Waste Type: <b>${user.waste_type}</b></p>
            <p>⚖️ Weight: <b>${user.weight}</b></p>
            <p>🎁 Eco Voucher Activated Successfully</p>
            <p>Thank you for recycling with RecyConnect 🌍</p>
          </div>
        `
      }, (mailerError) => {
          if (mailerError) console.error("❌ Async Admin Approval Notification Blocked:", mailerError.message);
          else console.log(`✅ Approval Email successfully routed to destination: ${user.email}`);
      });
    } 
    else if (status.toLowerCase() === "rejected") {
      transporter.sendMail({
        from: '"RecyConnect Team" <officialrecyconnect@gmail.com>',
        to: user.email.trim(),
        subject: "❌ RecyConnect Request Rejected",
        html: `
          <div style="font-family:Arial; padding:20px; line-height:1.8;">
            <h2 style="color:red;">Request Rejected</h2>
            <p>Dear <b>${user.name}</b>,</p>
            <p>Your recycling request has been rejected.</p>
            <p>Please verify your submitted details and try again.</p>
            <p>— Team RecyConnect</p>
          </div>
        `
      }, (mailerError) => {
          if (mailerError) console.error("❌ Async Admin Rejection Notification Blocked:", mailerError.message);
          else console.log(`✅ Rejection Email successfully routed to destination: ${user.email}`);
      });
    }

  } catch (err) {
    console.error("❌ Notification Engine Error Log:", err);
    if (!res.headersSent) {
        return res.status(500).json({ error: err.message });
    }
  }
});

// ADMIN DASHBOARD STATS
app.get("/admin/stats", async (req, res) => {
  try {
    const totalUsers = await pool.query("SELECT COUNT(*) FROM users");
    const totalRequests = await pool.query("SELECT COUNT(*) FROM waste_submissions");
    const approvedRequests = await pool.query("SELECT COUNT(*) FROM waste_submissions WHERE status = 'Approved'");
    const pendingRequests = await pool.query("SELECT COUNT(*) FROM waste_submissions WHERE status = 'Pending'");

    res.json({
      totalUsers: totalUsers.rows[0].count,
      totalRequests: totalRequests.rows[0].count,
      approvedRequests: approvedRequests.rows[0].count,
      pendingRequests: pendingRequests.rows[0].count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADMIN USERS LIST
app.get("/admin/users", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name, email, points FROM users ORDER BY points DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADMIN ANALYTICS
app.get("/admin/analytics", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT waste_type, SUM(weight) AS total_weight FROM waste_submissions GROUP BY waste_type ORDER BY total_weight DESC
    `);
    const totalWasteResult = await pool.query(`SELECT SUM(weight) AS total FROM waste_submissions`);
    const totalWaste = totalWasteResult.rows[0].total || 0;
    const highestWasteType = result.rows.length > 0 ? result.rows[0].waste_type : "N/A";

    res.json({
      wasteData: result.rows,
      totalWaste: totalWaste,
      highestWasteType: highestWasteType
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "RECYCONNECT", "index.html"));
});

// FETCH USER DASHBOARD DATA
app.get('/dashboard-data', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: "Email parameter is required" });
  }
  try {
    const user = await getCurrentUser(email);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const submissionsQuery = `
      SELECT id, waste_type, weight, status, TO_CHAR(pickup_date, 'YYYY-MM-DD') as pickup_date, points_earned
      FROM waste_submissions 
      WHERE user_id = $1 
      ORDER BY id DESC;
    `;
    const result = await pool.query(submissionsQuery, [user.id]);
    return res.status(200).json({ success: true, submissions: result.rows });
  } catch (error) {
    console.error("❌ Failed to fetch dashboard data:", error);
    return res.status(500).json({ error: "Internal database retrieval error." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Global Server is officially running live on port ${PORT}`);
});