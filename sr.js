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

    // Send email from user's email
    await transporter.sendMail({
      from: `"${user.name}" <${user.email}>`, // Display user's email as sender
      to: process.env.BOSS_EMAIL,
      subject: `Fund Request #${requestRes.insertId} Needs Approval`,
      text: `User Details:
Name: ${user.name}
Email: ${user.email}
Country: ${user.country}

Request Details:
Type: ${requestType}
Category: ${category}
Subcategory: ${subCategory}

Total Amount: ${totalRequest} (Items: ${totalAmount}, Fees: ${transactionCost})`,
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #1a365d;">New Fund Request (#${requestRes.insertId})</h2>
  
  <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
    <h3 style="color: #2d3748; margin-top: 0;">User Details</h3>
    <p><strong>Name:</strong> ${user.name}</p>
    <p><strong>Email:</strong> ${user.email}</p>
    <p><strong>Country:</strong> ${user.country}</p>
  </div>

  <div style="margin-top: 25px; background: #f8f9fa; padding: 20px; border-radius: 8px;">
    <h3 style="color: #2d3748; margin-top: 0;">Request Details</h3>
    <p><strong>Type:</strong> ${requestType}</p>
    <p><strong>Category:</strong> ${category}</p>
    <p><strong>Subcategory:</strong> ${subCategory}</p>
    <p><strong>Total Amount:</strong> ${totalRequest} (Items: ${totalAmount}, Fees: ${transactionCost})</p>
  </div>

  <div style="margin-top: 30px; text-align: center;">
    <p style="margin-bottom: 15px; color: #4a5568;">Approve or reject this request:</p>
    <a href="http://localhost:3000/api/requests/${
      requestRes.insertId
    }/approve?token=${approvalToken}"
       style="background: #4CAF50; color: white; padding: 12px 24px; 
              text-decoration: none; border-radius: 4px; margin-right: 15px;">
      Approve Request
    </a>
    <a href="http://localhost:3000/api/requests/${
      requestRes.insertId
    }/reject?token=${approvalToken}"
       style="background: #f44336; color: white; padding: 12px 24px; 
              text-decoration: none; border-radius: 4px;">
      Reject Request
    </a>
  </div>

  <p style="margin-top: 30px; color: #718096; font-size: 0.9em;">
    Request ID: ${requestRes.insertId}<br>
    Submitted at: ${new Date().toLocaleString()}
  </p>
</div>
`,
    });

    await connection.commit();
    res.status(201).json({ message: "Request submitted successfully" });
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

// Add these new routes
app.get("/api/requests/:id/approve", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { token } = req.query;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [request] = await connection.query(
      `SELECT * FROM request_type 
       WHERE Id = ? 
         AND approval_token = ?
         AND email_status = 'pending'`,
      [id, token]
    );

    if (!request.length) {
      await connection.rollback();
      return res.status(400).send("Invalid approval link");
    }
    if (request[0].status !== "pending")
      return res.send("Request already processed");
    // Update email_status $ status to approved
    await connection.query(
      `UPDATE request_type 
         SET email_status = 'approved' 
         WHERE Id = ?`,
      [id]
    );

    // Get user email
    const [[user]] = await pool.query(
      `SELECT u.email FROM users u
       JOIN request_type rt ON rt.users_id = u.Id
       WHERE rt.Id = ?`,
      [id]
    );
    // Send approval email
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
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Request Approved",
      html: `<p>Your request #${id} has been approved!</p>`,
    });
    await connection.commit();
    res.send("Request approved successfully");
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Email Error:", error);
    res.status(500).send("Error processing approval");
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/requests/:id/reject", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { token } = req.query;

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [request] = await connection.query(
      `SELECT * FROM request_type 
       WHERE Id = ? 
         AND approval_token = ?
         AND email_status = 'pending'`,
      [id, token]
    );

    if (!request.length) {
      await connection.rollback();
      return res.status(400).send("Invalid rejection link");
    }
    if (request[0].status !== "pending")
      return res.send("Request already processed");
    //email_status $ status reject updated
    await connection.query(
      `UPDATE request_type 
       SET email_status = 'rejected' 
       WHERE Id = ?`,
      [id]
    );
    // Get user email
    const [[user]] = await pool.query(
      `SELECT u.email FROM users u
       JOIN request_type rt ON rt.users_id = u.Id
       WHERE rt.Id = ?`,
      [id]
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
      to: user.email,
      subject: "Request Rejected",
      html: `<p>Your request #${id} has been rejected.</p>`,
    });

    res.send("Request rejected successfully");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error processing rejection");
  }
});