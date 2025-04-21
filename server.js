require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const nodemailer = require("nodemailer");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fileUpload = require("express-fileupload");
const generateToken = () => crypto.randomBytes(20).toString("hex");
const { Readable } = require("stream");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configure Google Drive
const { google } = require("googleapis");
let auth;
try {
  auth = new google.auth.GoogleAuth({
    keyFile: "./service-account-key.json",
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  console.log("Successfully authenticated with Google Drive");
} catch (error) {
  console.error("Google Drive authentication failed:", error);
  process.exit(1);
}

const drive = google.drive({ version: "v3", auth });

// Enable preflight requests
//app.options("*", cors());

// Enhanced CORS config
/*app.use(
  cors({
    origin: "http://localhost:5500",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});*/
// Create connection pool (corrected)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});
pool
  .getConnection()
  .then((connection) => {
    console.log("Successfully connected to MySQL");
    connection.release();
  })
  .catch((err) => {
    console.error("Database Connection Error:", err);
    process.exit(1);
  });

// uploadToDrive function
async function uploadToDrive(file, fileName, folderId) {
  // Convert buffer to stream
  const bufferStream = new Readable();
  bufferStream.push(file.buffer);
  bufferStream.push(null);

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: file.mimetype,
      body: bufferStream,
    },
  });

  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
    fields: "id",
  });

  // Use webContentLink for direct download
  return `https://drive.google.com/uc?export=download&id=${res.data.id}`;

  if (file.data.length < 10) {
    // Minimum 10 bytes
    return res.status(400).json({ error: "Empty file detected" });
  }
}

// Register User
app.post("/api/register", async (req, res) => {
  const { name, email, pin, country } = req.body;
  try {
    const hashedPin = await bcrypt.hash(pin, 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, pin, country) VALUES (?, ?, ?, ?)",
      [name, email, hashedPin, country]
    );
    res.send({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).send(err);
  }
});
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) {
        console.error("JWT Verification Error:", err);
        return res.sendStatus(403);
      }

      console.log("Authenticated User:", user);
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};
// Add after initial middleware setup
app.use(
  fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    abortOnLimit: true,
    useTempFiles: true,
    tempFileDir: "/tmp/",
  })
);

// Add upload endpoint
app.post("/api/upload", authenticateJWT, async (req, res) => {
  try {
    if (!req.files || !req.files.attachment) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file = req.files.attachment;
    const fileName = file.name || `file_${Date.now()}`;

    // Handle different file types
    const mimeType = file.mimetype || "application/octet-stream";
    const fileExtension = file.name.split(".").pop() || "bin";

    const driveLink = await uploadToDrive(
      {
        buffer: file.data,
        mimetype: mimeType,
      },
      `${fileName}.${fileExtension}`,
      process.env.GOOGLE_DRIVE_FOLDER_ID
    );

    res.json({ driveLink });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: "File upload failed" });
  }
}); // Login
app.post("/api/login", async (req, res) => {
  const { credential, pin } = req.body;
  try {
    const [results] = await pool.query(
      "SELECT * FROM users WHERE name = ? OR email = ?",
      [credential, credential]
    );

    if (results.length === 0)
      return res.status(401).send({ message: "Invalid credentials" });

    const user = results[0];
    const match = await bcrypt.compare(pin, user.pin);
    if (!match) return res.status(401).send({ message: "Invalid PIN" });
    const token = jwt.sign({ Id: user.Id }, process.env.JWT_SECRET);

    // Send user data in response
    res.send({
      message: "Login successful",
      token,
      user: {
        Id: user.Id,
        name: user.name,
        email: user.email,
        country: user.country,
      },
    });
  } catch (err) {
    res.status(500).send(err);
  }
});

// Submit Fund Request Endpoint
app.post("/api/requests", authenticateJWT, async (req, res) => {
  console.log("Request Body:", req.body);
  console.log("Request Type:", req.body.requestType);
  console.log("Attachments Received:", req.body.attachments?.length || 0);
  const { requestType, category, subCategory, expenseItems, transactionCost } =
    req.body;
  const userId = req.user.Id;

  let connection;
  try {
    const approvalToken = generateToken();
    if (!req.body.requestType || !req.body.category) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [[userData]] = await connection.query(
      "SELECT country FROM users WHERE Id = ?",
      [userId]
    );

    // Insert request type
    const [requestRes] = await connection.query(
      `INSERT INTO request_type 
        (users_id, REQUEST_TYPE, email_status, country)
       VALUES (?, ?, 'colleague_pending', ?)`,
      [userId, requestType, userData.country]
    );
    const requestId = requestRes.insertId;
    if (req.body.attachments && req.body.attachments.length > 0) {
      for (const attachment of req.body.attachments) {
        await connection.query(
          `INSERT INTO attachments 
            (request_id, file_type, drive_link, file_name)
           VALUES (?, ?, ?, ?)`,
          [
            requestId,
            attachment.type,
            attachment.content, // This is now the drive link
            attachment.fileName,
          ]
        );
      }
    }

    // Insert category
    const [categoryRes] = await connection.query(
      `INSERT INTO categories (request_type_id, NAME)
       VALUES (?, ?)`,
      [requestId, category]
    );

    // Insert subcategory
    const [subCategoryRes] = await connection.query(
      `INSERT INTO Subcategories (Categories_id, NAME)
       VALUES (?, ?)`,
      [categoryRes.insertId, subCategory]
    );

    // Process expense items
    let totalAmount = 0;
    for (const item of expenseItems) {
      const [expenseRes] = await connection.query(
        `INSERT INTO expense_item (Subcategories_id, description, Amount, Quantity)
         VALUES (?, ?, ?, ?)`,
        [subCategoryRes.insertId, item.description, item.amount, item.quantity]
      );
      totalAmount += item.amount * item.quantity;
    }

    // Calculate total request
    const totalRequest = totalAmount + (transactionCost || 0);
    await connection.query(
      `INSERT INTO total_request (Total_Amount, Total_Request, Transaction_Amount, request_type_id)
       VALUES (?, ?, ?, ?)`,
      [totalAmount, totalRequest, transactionCost, requestId]
    );

    // Get user details
    const [[user]] = await connection.query(
      "SELECT name, email, country FROM users WHERE Id = ?",
      [userId]
    );
    // Find colleagues in same country (excluding requester)
    const [colleagues] = await connection.query(
      `SELECT * FROM users 
       WHERE country = ? 
         AND Id != ?`,
      [user.country, userId]
    );

    // Send approval requests to colleagues
    const transporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: process.env.EMAIL_PORT,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    for (const colleague of colleagues) {
      const colleagueToken = generateToken();
      console.log("Storing token:", colleagueToken);

      await connection.query(
        `INSERT INTO colleague_approvals 
          (request_id, colleague_id, token)
         VALUES (?, ?, ?)`,
        [requestId, colleague.Id, colleagueToken]
      );
      const [attachments] = await connection.query(
        "SELECT file_name, drive_link FROM attachments WHERE request_id = ?",
        [requestId]
      );
      // Build items list HTML
      const itemsHtml = expenseItems
        .map(
          (item, index) => `
        <div style="margin-bottom: 15px; padding: 10px; border-left: 3px solid #4a5568;">
          <p><strong>Item ${index + 1}:</strong></p>
          <p>Description: ${item.description}</p>
          <p>Amount: ${item.amount} x Quantity: ${item.quantity}</p>
          <p>Subtotal: ${item.amount * item.quantity}</p>
        </div>
      `
        )
        .join("");

      await transporter.sendMail({
        to: colleague.email,
        subject: `Approval Required for Request #${requestId}`,
        html: `
          <p>Dear ${colleague.name},</p>
          <p>${user.name} from FH-${user.country} has requested funds:</p>
          
          <div style="margin: 20px 0; padding: 20px; background: #f8f9fa;">
            <h3 style="margin-top: 0;">Request Details</h3>
            <p><strong>Type:</strong> ${requestType}</p>
            <p><strong>Category:</strong> ${category}</p>
            <p><strong>Sub-category:</strong> ${subCategory}</p>
            
            <h4 style="margin: 15px 0 10px 0;">Expense Items:</h4>
            ${itemsHtml}
            
            <p style="margin-top: 20px;">
              <strong>Transaction Cost:</strong> ${transactionCost || 0}<br>
              <strong>Total Request:</strong> ${totalRequest}
            </p>
          </div>
    
          <div style="margin-top: 20px;">
            <a href="${
              process.env.BASE_URL
            }/api/requests/${requestId}/colleague-approve?token=${colleagueToken}"
               style="background: #4CAF50; color: white; padding: 10px 20px;">
               Approve
            </a>
            <a href="${
              process.env.BASE_URL
            }/api/requests/${requestId}/colleague-reject?token=${colleagueToken}"
               style="background: #f44336; color: white; padding: 10px 20px;">
               Reject
            </a>
          </div>
          <p>Best regards,<br>FH260 Admin Team</p>
  ...
  <p>Attachments:</p>
  <ul>
    ${attachments
      .map(
        (a) => `
      <li>
        <a href="https://drive.google.com/uc?export=download&id=${
          a.drive_link.split("id=")[1]
        }" 
           download="${a.file_name}">
          ${a.file_name} (Click to Download)
        </a>
      </li>
    `
      )
      .join("")}
  </ul>
  ...
        `,
      });
    }
    await connection.commit();
    res
      .status(201)
      .json({ message: "Request submitted for colleague approval" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Full Error Stack:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
});
// Colleague Approval
app.get("/api/requests/:id/colleague-approve", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { token } = req.query;
    const decodedToken = decodeURIComponent(token);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const bossToken = generateToken();
    await connection.query(
      `INSERT INTO boss_approvals (request_id, token)
       VALUES (?, ?) 
       ON DUPLICATE KEY UPDATE token = VALUES(token)`,
      [id, bossToken]
    );

    // Validate approval
    const [approval] = await connection.query(
      `SELECT * FROM colleague_approvals 
       WHERE request_id = ? AND token = ?`,
      [id, decodedToken]
    );

    if (!approval.length) {
      await connection.rollback();
      console.error("Invalid token:", decodedToken);
      return res.status(400).send("Invalid approval link");
    }
    // Delete token immediately after validation
    await connection.query(
      `DELETE FROM colleague_approvals 
         WHERE request_id = ? AND token = ?`,
      [id, decodedToken]
    );

    // Update request status and store colleague ID
    await connection.query(
      `UPDATE request_type 
       SET email_status = 'boss_pending', 
           colleague_approver_id = ?
       WHERE Id = ?`,
      [approval[0].colleague_id, id]
    );

    // Get requester and colleague details
    const [[request]] = await connection.query(
      `SELECT u.* FROM request_type rt
       JOIN users u ON rt.users_id = u.Id
       WHERE rt.Id = ?`,
      [id]
    );

    const [[colleague]] = await connection.query(
      `SELECT * FROM users WHERE Id = ?`,
      [approval[0].colleague_id]
    );

    // Send notification to requester
    const userTransporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: process.env.EMAIL_PORT,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    await userTransporter.sendMail({
      to: request.email,
      subject: "Request Forwarded to Boss",
      html: `
        <p>Dear ${request.name},</p>
        <p>Your request #${id} has been approved by ${colleague.name} and forwarded to the boss for final approval.</p>
        <p>Best regards,<br>FH260 Admin Team</p>
      `,
    });

    // Send to boss
    const bossTransporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: process.env.EMAIL_PORT,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    // Get full request details with all expense items
    const [requestDetails] = await connection.query(
      `
  SELECT 
    rt.REQUEST_TYPE,
    c.NAME AS category,
    sc.NAME AS subCategory,
    ei.description,
    ei.Amount AS amount,
    ei.Quantity AS quantity,
    tr.Total_Amount,
    tr.Total_Request,
    tr.Transaction_Amount
  FROM request_type rt
  JOIN categories c ON rt.Id = c.request_type_id
  JOIN subcategories sc ON c.Id = sc.Categories_id
  JOIN expense_item ei ON sc.Id = ei.Subcategories_id
  JOIN total_request tr ON rt.Id = tr.request_type_id
  WHERE rt.Id = ?
`,
      [id]
    );
    const [attachments] = await connection.query(
      "SELECT file_name, drive_link FROM attachments WHERE request_id = ?",
      [id]
    );
    // Build items list HTML
    const itemsHtml = requestDetails
      .map(
        (item, index) => `
  <div style="margin-bottom: 15px; padding: 10px; border-left: 3px solid #4a5568;">
    <p><strong>Item ${index + 1}:</strong></p>
    <p>Description: ${item.description}</p>
    <p>Amount: ${item.amount} x Quantity: ${item.quantity}</p>
    <p>Subtotal: ${item.amount * item.quantity}</p>
  </div>
`
      )
      .join("");

    await bossTransporter.sendMail({
      to: process.env.BOSS_EMAIL,
      subject: `Fund Request #${id} from ${request.name} (Approved by ${colleague.name})`,
      html: `
    <p>Hello ${process.env.BOSS_NAME},</p>
    <p>${request.name} from FH-${request.country} has requested funds:</p>
    
    <div style="margin: 20px 0; padding: 20px; background: #f8f9fa;">
      <h3 style="margin-top: 0;">Request Details</h3>
      <p><strong>Type:</strong> ${requestDetails[0].REQUEST_TYPE}</p>
      <p><strong>Category:</strong> ${requestDetails[0].category}</p>
      <p><strong>Sub-category:</strong> ${requestDetails[0].subCategory}</p>
      
      <h4 style="margin: 15px 0 10px 0;">Expense Items:</h4>
      ${itemsHtml}
      
      <p style="margin-top: 20px;">
        <strong>Total Items:</strong> ${requestDetails[0].Total_Amount}<br>
        <strong>Transaction Cost:</strong> ${
          requestDetails[0].Transaction_Amount
        }<br>
        <strong>Total Request:</strong> ${requestDetails[0].Total_Request}
      </p>
    </div>

    <div style="margin-top: 20px; text-align: center;">
      <p style="margin-bottom: 15px; color: #4a5568;">Kindly Approve or Reject this Request:</p>
      <a href="${
        process.env.BASE_URL
      }/api/requests/${id}/boss-approve?token=${bossToken}"
         style="background: #4CAF50; color: white; padding: 10px 20px;">
         Approve
      </a>
          <a href="${
            process.env.BASE_URL
          }/api/requests/${id}/boss-reject?token=${bossToken}"
         style="background: #f44336; color: white; padding: 10px 20px;">
         Reject
      </a>
    </div>
    
    <p style="margin-top: 30px; color: #718096; font-size: 0.9em;">
      Request ID: ${id}<br>
      Submitted at: ${new Date().toLocaleString()}
    </p>
   ...
  <p>Attachments:</p>
  <ul>
    ${attachments
      .map(
        (a) => `
      <li>
        <a href="https://drive.google.com/uc?export=download&id=${
          a.drive_link.split("id=")[1]
        }" 
           download="${a.file_name}">
          ${a.file_name} (Click to Download)
        </a>
      </li>
    `
      )
      .join("")}
  </ul>
  ...
  `,
    });
    await connection.commit();
    res.send("Request forwarded to boss for approval");
  } catch (error) {
    await connection.rollback();
    console.error("Approval Error:", error);
    res.status(500).send("Error processing approval");
  } finally {
    if (connection) connection.release();
  }
});

// Colleague Rejection
app.get("/api/requests/:id/colleague-reject", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { token } = req.query;
    const decodedToken = decodeURIComponent(token);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Validate rejection
    const [approval] = await connection.query(
      `SELECT * FROM colleague_approvals 
       WHERE request_id = ? AND token = ?`,
      [id, decodedToken]
    );

    if (!approval.length) {
      await connection.rollback();
      console.error("Invalid token:", decodedToken);
      return res.status(400).send("Invalid rejection link");
    }

    // Delete token immediately after validation
    await connection.query(
      `DELETE FROM colleague_approvals 
         WHERE request_id = ? AND token = ?`,
      [id, decodedToken]
    );

    // Update request status
    await connection.query(
      `UPDATE request_type 
       SET email_status = 'rejected', 
           colleague_approver_id = ?
       WHERE Id = ?`,
      [approval[0].colleague_id, id]
    );

    // Get requester and colleague details
    const [[request]] = await connection.query(
      `SELECT u.* FROM request_type rt
       JOIN users u ON rt.users_id = u.Id
       WHERE rt.Id = ?`,
      [id]
    );

    const [[colleague]] = await connection.query(
      `SELECT * FROM users WHERE Id = ?`,
      [approval[0].colleague_id]
    );

    // Send rejection email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: process.env.EMAIL_PORT,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    await transporter.sendMail({
      to: request.email,
      subject: "Request Rejected by Colleague",
      html: `
        <p>Dear ${request.name},</p>
        <p>Your request #${id} has been rejected by ${colleague.name}.</p>
        <p>Please contact ${colleague.name} at ${colleague.email} for more information.</p>
        <p>Best regards,<br>FH260 Admin Team</p>
      `,
    });

    await connection.commit();
    res.send("Request rejected successfully");
  } catch (error) {
    await connection.rollback();
    console.error("Approval Error:", error);
    res.status(500).send("Error processing rejection");
  } finally {
    if (connection) connection.release();
  }
});
// Boss Approval
app.get("/api/requests/:id/boss-approve", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { token } = req.query;
    const decodedToken = decodeURIComponent(token);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Validate boss token
    const [approval] = await connection.query(
      `SELECT * FROM boss_approvals 
       WHERE request_id = ? AND token = ?`,
      [id, decodedToken]
    );

    if (!approval.length) {
      await connection.rollback();
      return res.status(400).send("Invalid approval link");
    }

    // Update request status
    await connection.query(
      `UPDATE request_type 
       SET email_status = 'approved'
       WHERE Id = ?`,
      [id]
    );

    // Delete used token
    await connection.query(`DELETE FROM boss_approvals WHERE request_id = ?`, [
      id,
    ]);

    // Get requester details
    const [[user]] = await connection.query(
      `SELECT u.* FROM request_type rt
       JOIN users u ON rt.users_id = u.Id
       WHERE rt.Id = ?`,
      [id]
    );

    // Send final approval email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: process.env.EMAIL_PORT,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    await transporter.sendMail({
      to: user.email,
      subject: "Fund Request Approved",
      html: `
        <p>Dear ${user.name},</p>
        <p>We are pleased to inform you that your request #${id} for 
        funds has been fully approved and will be processed.</p>
        <p>Best regards,<br>FH260 Admin Team</p>
      `,
    });

    await connection.commit();
    res.send("Request fully approved");
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).send("Error processing approval");
  } finally {
    if (connection) connection.release();
  }
});

// Boss Rejection
app.get("/api/requests/:id/boss-reject", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { token } = req.query;
    const decodedToken = decodeURIComponent(token);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Validate boss token
    const [approval] = await connection.query(
      `SELECT * FROM boss_approvals 
       WHERE request_id = ? AND token = ?`,
      [id, decodedToken]
    );

    if (!approval.length) {
      await connection.rollback();
      return res.status(400).send("Invalid rejection  link");
    }

    // Update request status
    await connection.query(
      `UPDATE request_type 
       SET email_status = 'rejected'
       WHERE Id = ?`,
      [id]
    );

    // Delete used token
    await connection.query(`DELETE FROM boss_approvals WHERE request_id = ?`, [
      id,
    ]);

    // Get requester details
    const [[user]] = await connection.query(
      `SELECT u.* FROM request_type rt
       JOIN users u ON rt.users_id = u.Id
       WHERE rt.Id = ?`,
      [id]
    );

    // Send final approval email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: process.env.EMAIL_PORT,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    await transporter.sendMail({
      to: user.email,
      subject: "Fund Request Rejected",
      html: `
        <p>Dear ${user.name},</p>
        <p>We regret to inform you that your request #${id} for 
        funds has been rejected.Kindly contact Mrs.${process.env.BOSS_NAME} for further details</p>
        <p>Best regards,<br>FH260 Admin Team</p>
      `,
    });

    await connection.commit();
    res.send("Request rejected");
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).send("Error processing rejection");
  } finally {
    if (connection) connection.release();
  }
});
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
