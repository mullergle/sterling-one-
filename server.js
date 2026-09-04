require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const supabase = require("./supabase");

const app = express();

app.use(cors());
app.use(express.json());


// =====================================================
// BASIC
// =====================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Sterling One Bank API is running"
  });
});


// =====================================================
// SUPABASE TEST
// =====================================================

app.get("/api/test-supabase", async (req, res) => {
  try {
    const { error } = await supabase
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Supabase connection failed",
        error: error.message
      });
    }

    res.json({
      success: true,
      message: "Supabase connection successful"
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});


// =====================================================
// HELPERS
// =====================================================

function generateReference(prefix = "STL") {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}


async function generateAccountNumber() {
  while (true) {
    const number =
      "4" +
      Math.floor(100000000 + Math.random() * 900000000);

    const { data } = await supabase
      .from("accounts")
      .select("id")
      .eq("account_number", number)
      .maybeSingle();

    if (!data) {
      return number;
    }
  }
}


// =====================================================
// AUTH MIDDLEWARE
// =====================================================

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    const {
      data: { user },
      error
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session"
      });
    }

    req.user = user;

    next();

  } catch (error) {
    console.error(error);

    res.status(401).json({
      success: false,
      message: "Authentication failed"
    });
  }
}


// =====================================================
// ADMIN MIDDLEWARE
// =====================================================

async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    const {
      data: { user },
      error
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session"
      });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_profiles")
      .select("*")
      .eq("id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({
        success: false,
        message: "Administrator access required"
      });
    }

    req.user = user;
    req.admin = admin;

    next();

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Admin authentication failed"
    });
  }
}


// =====================================================
// REGISTER
// =====================================================

app.post("/api/auth/register", async (req, res) => {
  try {
    const {
    fname,
    sname,
    lname,
    email,
    ssn,
    phone,
    pass,
    cpass,
    country,
    state,
    city,
    address,
    terms
} = req.body;

    // -----------------------------
    // Validate fields
    // -----------------------------

    if (
      !fname ||
      !sname ||
      !lname ||
      !email ||
      !phone ||
      !pass ||
      !cpass ||
      !country ||
      !state ||
      !city ||
      !address
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided"
      });
    }


    // -----------------------------
    // Terms
    // -----------------------------

    if (terms !== true) {
      return res.status(400).json({
        success: false,
        message: "You must accept the terms and conditions"
      });
    }


    // -----------------------------
    // Password confirmation
    // -----------------------------

    if (pass !== cpass) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match"
      });
    }


    // -----------------------------
    // Password length
    // -----------------------------

    if (pass.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters"
      });
    }


    // -----------------------------
    // Create Supabase Auth user
    // -----------------------------

    const {
      data: authData,
      error: authError
    } = await supabase.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password: pass,
      email_confirm: true
    });

    if (authError) {
      return res.status(400).json({
        success: false,
        message: authError.message
      });
    }

    const userId = authData.user.id;


    // -----------------------------
    // Create profile
    // -----------------------------

    const { error: profileError } = await supabase
      .from("profiles")
      .insert({
        id: userId,
        first_name: fname.trim(),
        surname: sname.trim(),
        last_name: lname.trim(),
        phone: phone.trim(),
        ssn: ssn.trim()
      });

    if (profileError) {
      await supabase.auth.admin.deleteUser(userId);

      return res.status(500).json({
        success: false,
        message: "Unable to create customer profile"
      });
    }


    // -----------------------------
    // Create address
    // -----------------------------

    const { error: addressError } = await supabase
      .from("customer_addresses")
      .insert({
        user_id: userId,
        country: country.trim(),
        state: state.trim(),
        city: city.trim(),
        house_address: address.trim()
      });

    if (addressError) {
      await supabase.auth.admin.deleteUser(userId);

      return res.status(500).json({
        success: false,
        message: "Unable to save customer address"
      });
    }


    // -----------------------------
    // Generate account number
    // -----------------------------

    const accountNumber = await generateAccountNumber();


    // -----------------------------
    // Create checking account
    // -----------------------------

    const {
      data: account,
      error: accountError
    } = await supabase
      .from("accounts")
      .insert({
        user_id: userId,
        account_number: accountNumber,
        account_type: "checking",
        currency: "USD",
        status: "active"
      })
      .select()
      .single();

    if (accountError) {
      await supabase.auth.admin.deleteUser(userId);

      return res.status(500).json({
        success: false,
        message: "Unable to create bank account"
      });
    }


    // -----------------------------
    // Create account balance
    // -----------------------------

    const { error: balanceError } = await supabase
      .from("account_balances")
      .insert({
        account_id: account.id,
        available_balance: 0,
        ledger_balance: 0
      });

    if (balanceError) {
      await supabase.auth.admin.deleteUser(userId);

      return res.status(500).json({
        success: false,
        message: "Unable to create account balance"
      });
    }


    // -----------------------------
    // Save terms consent
    // -----------------------------

    await supabase
      .from("customer_consents")
      .insert({
        user_id: userId,
        consent_type: "terms",
        version: "1.0"
      });


    // -----------------------------
    // Save privacy consent
    // -----------------------------

    await supabase
      .from("customer_consents")
      .insert({
        user_id: userId,
        consent_type: "privacy",
        version: "1.0"
      });


    // -----------------------------
    // Welcome notification
    // -----------------------------

    await supabase
      .from("notifications")
      .insert({
        user_id: userId,
        title: "Welcome to Sterling One Bank",
        message: "Your Sterling One Bank account has been created successfully.",
        type: "account"
      });


    res.status(201).json({
      success: true,
      message: "Registration successful",
      user_id: userId,
      account_number: accountNumber
    });

  } catch (error) {
    console.error("Registration error:", error);

    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});


// =====================================================
// LOGIN
// =====================================================

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const {
      data,
      error
    } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password
    });

    if (error) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    res.json({
      success: true,
      message: "Login successful",
      session: data.session,
      user: data.user
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});


// =====================================================
// GET CURRENT USER
// =====================================================

app.get("/api/auth/me", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    const { data: address } = await supabase
      .from("customer_addresses")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: accounts } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", userId);

    res.json({
      success: true,
      user: req.user,
      profile,
      address,
      accounts
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to load user"
    });
  }
});


// =====================================================
// PASSWORD RESET REQUEST
// =====================================================

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    const { error } =
      await supabase.auth.resetPasswordForEmail(
        email.toLowerCase().trim()
      );

    if (error) {
      console.error(error);
    }

    // Do not reveal whether the email exists.
    res.json({
      success: true,
      message:
        "If an account exists for this email, password reset instructions have been sent."
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to process password reset"
    });
  }
});


// =====================================================
// ACCOUNTS
// =====================================================

app.get("/api/accounts", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("accounts")
      .select(`
        *,
        account_balances (
          available_balance,
          ledger_balance,
          updated_at
        )
      `)
      .eq("user_id", req.user.id);

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      accounts: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to load accounts"
    });
  }
});


// =====================================================
// ACCOUNT DETAILS
// =====================================================

app.get("/api/accounts/:id", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("accounts")
      .select(`
        *,
        account_balances (
          available_balance,
          ledger_balance,
          updated_at
        )
      `)
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: "Account not found"
      });
    }

    res.json({
      success: true,
      account: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to load account"
    });
  }
});


// =====================================================
// TRANSACTIONS
// =====================================================

app.get("/api/transactions", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      transactions: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to load transactions"
    });
  }
});


// =====================================================
// BENEFICIARIES
// =====================================================

app.get("/api/beneficiaries", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      beneficiaries: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to load beneficiaries"
    });
  }
});


app.post("/api/beneficiaries", authenticate, async (req, res) => {
  try {
    const {
      name,
      bank_name,
      account_identifier,
      account_type
    } = req.body;

    if (!name || !bank_name || !account_identifier) {
      return res.status(400).json({
        success: false,
        message: "Required beneficiary information is missing"
      });
    }

    const { data, error } = await supabase
      .from("beneficiaries")
      .insert({
        user_id: req.user.id,
        name,
        bank_name,
        account_identifier,
        account_type: account_type || "checking"
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(201).json({
      success: true,
      message: "Beneficiary added",
      beneficiary: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to create beneficiary"
    });
  }
});


app.delete(
  "/api/beneficiaries/:id",
  authenticate,
  async (req, res) => {
    try {
      const { error } = await supabase
        .from("beneficiaries")
        .delete()
        .eq("id", req.params.id)
        .eq("user_id", req.user.id);

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      res.json({
        success: true,
        message: "Beneficiary deleted"
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to delete beneficiary"
      });
    }
  }
);


// =====================================================
// TRANSFER REQUEST
// =====================================================

app.post("/api/transfers", authenticate, async (req, res) => {
  try {
    const {
      sender_account_id,
      beneficiary_id,
      amount
    } = req.body;

    if (!sender_account_id || !beneficiary_id || !amount) {
      return res.status(400).json({
        success: false,
        message: "Account, beneficiary and amount are required"
      });
    }

    const transferAmount = Number(amount);

    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid transfer amount"
      });
    }


    // Verify sender account belongs to user

    const { data: account } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", sender_account_id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Sender account not found"
      });
    }


    // Verify beneficiary belongs to user

    const { data: beneficiary } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("id", beneficiary_id)
      .eq("user_id", req.user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!beneficiary) {
      return res.status(404).json({
        success: false,
        message: "Beneficiary not found"
      });
    }


    // Get balance

    const { data: balance } = await supabase
      .from("account_balances")
      .select("*")
      .eq("account_id", sender_account_id)
      .maybeSingle();

    if (!balance) {
      return res.status(404).json({
        success: false,
        message: "Account balance not found"
      });
    }

    if (Number(balance.available_balance) < transferAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient funds"
      });
    }


    const reference = generateReference("TRF");


    // Create transfer

    const {
      data: transfer,
      error
    } = await supabase
      .from("transfers")
      .insert({
        sender_user_id: req.user.id,
        sender_account_id,
        beneficiary_id,
        amount: transferAmount,
        currency: account.currency,
        reference,
        status: "pending"
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }


    res.status(201).json({
      success: true,
      message: "Transfer submitted for processing",
      transfer
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to create transfer"
    });
  }
});


// =====================================================
// WITHDRAWAL REQUEST
// =====================================================

app.post("/api/withdrawals", authenticate, async (req, res) => {
  try {
    const {
      account_id,
      amount,
      destination,
      reason
    } = req.body;

    if (!account_id || !amount) {
      return res.status(400).json({
        success: false,
        message: "Account and amount are required"
      });
    }

    const withdrawalAmount = Number(amount);

    if (
      !Number.isFinite(withdrawalAmount) ||
      withdrawalAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid withdrawal amount"
      });
    }


    // Verify account

    const { data: account } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", account_id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found"
      });
    }


    // Verify balance

    const { data: balance } = await supabase
      .from("account_balances")
      .select("*")
      .eq("account_id", account_id)
      .maybeSingle();

    if (!balance) {
      return res.status(404).json({
        success: false,
        message: "Account balance not found"
      });
    }

    if (
      Number(balance.available_balance) <
      withdrawalAmount
    ) {
      return res.status(400).json({
        success: false,
        message: "Insufficient funds"
      });
    }


    const {
      data,
      error
    } = await supabase
      .from("withdrawals")
      .insert({
        user_id: req.user.id,
        account_id,
        amount: withdrawalAmount,
        currency: account.currency,
        destination: destination || null,
        reason: reason || null,
        status: "pending"
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }


    res.status(201).json({
      success: true,
      message: "Withdrawal request submitted",
      withdrawal: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to create withdrawal"
    });
  }
});


// =====================================================
// CUSTOMER WITHDRAWALS
// =====================================================

app.get("/api/withdrawals", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("withdrawals")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      withdrawals: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to load withdrawals"
    });
  }
});


// =====================================================
// CARDS
// =====================================================

app.get("/api/cards", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      cards: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to load cards"
    });
  }
});


// =====================================================
// NOTIFICATIONS
// =====================================================

app.get(
  "/api/notifications",
  authenticate,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", req.user.id)
        .order("created_at", {
          ascending: false
        });

      if (error) {
        return res.status(500).json({
          success: false,
          message: error.message
        });
      }

      res.json({
        success: true,
        notifications: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to load notifications"
      });
    }
  }
);


// =====================================================
// MARK NOTIFICATION AS READ
// =====================================================

app.patch(
  "/api/notifications/:id/read",
  authenticate,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("notifications")
        .update({
          read_at: new Date().toISOString()
        })
        .eq("id", req.params.id)
        .eq("user_id", req.user.id)
        .select()
        .maybeSingle();

      if (error || !data) {
        return res.status(404).json({
          success: false,
          message: "Notification not found"
        });
      }

      res.json({
        success: true,
        notification: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to update notification"
      });
    }
  }
);


// =====================================================
// SUPPORT - CREATE CONVERSATION
// =====================================================

app.post(
  "/api/support/conversations",
  authenticate,
  async (req, res) => {
    try {
      const { subject, message } = req.body;

      if (!subject || !message) {
        return res.status(400).json({
          success: false,
          message: "Subject and message are required"
        });
      }


      // Create conversation

      const {
        data: conversation,
        error: conversationError
      } = await supabase
        .from("support_conversations")
        .insert({
          user_id: req.user.id,
          subject,
          status: "open"
        })
        .select()
        .single();

      if (conversationError) {
        return res.status(400).json({
          success: false,
          message: conversationError.message
        });
      }


      // Create first message

      const {
        data: supportMessage,
        error: messageError
      } = await supabase
        .from("support_messages")
        .insert({
          conversation_id: conversation.id,
          sender_type: "customer",
          sender_id: req.user.id,
          message
        })
        .select()
        .single();

      if (messageError) {
        return res.status(400).json({
          success: false,
          message: messageError.message
        });
      }


      res.status(201).json({
        success: true,
        conversation,
        message: supportMessage
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to create support conversation"
      });
    }
  }
);


// =====================================================
// SUPPORT - CUSTOMER CONVERSATIONS
// =====================================================

app.get(
  "/api/support/conversations",
  authenticate,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("support_conversations")
        .select("*")
        .eq("user_id", req.user.id)
        .order("updated_at", {
          ascending: false
        });

      if (error) {
        return res.status(500).json({
          success: false,
          message: error.message
        });
      }

      res.json({
        success: true,
        conversations: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to load support conversations"
      });
    }
  }
);


// =====================================================
// SUPPORT - GET MESSAGES
// =====================================================

app.get(
  "/api/support/conversations/:id/messages",
  authenticate,
  async (req, res) => {
    try {
      const { data: conversation } = await supabase
        .from("support_conversations")
        .select("id")
        .eq("id", req.params.id)
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }


      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .eq("conversation_id", req.params.id)
        .order("created_at", {
          ascending: true
        });

      if (error) {
        return res.status(500).json({
          success: false,
          message: error.message
        });
      }

      res.json({
        success: true,
        messages: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to load messages"
      });
    }
  }
);


// =====================================================
// SUPPORT - SEND CUSTOMER MESSAGE
// =====================================================

app.post(
  "/api/support/conversations/:id/messages",
  authenticate,
  async (req, res) => {
    try {
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({
          success: false,
          message: "Message is required"
        });
      }


      const { data: conversation } = await supabase
        .from("support_conversations")
        .select("id")
        .eq("id", req.params.id)
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }


      const {
        data,
        error
      } = await supabase
        .from("support_messages")
        .insert({
          conversation_id: req.params.id,
          sender_type: "customer",
          sender_id: req.user.id,
          message
        })
        .select()
        .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }


      await supabase
        .from("support_conversations")
        .update({
          updated_at: new Date().toISOString(),
          status: "open"
        })
        .eq("id", req.params.id)
        .eq("user_id", req.user.id);


      res.status(201).json({
        success: true,
        message: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to send message"
      });
    }
  }
);


// =====================================================
// ADMIN - DASHBOARD STATS
// =====================================================

app.get(
  "/api/admin/stats",
  authenticateAdmin,
  async (req, res) => {
    try {

      const { count: users } = await supabase
        .from("profiles")
        .select("*", {
          count: "exact",
          head: true
        });


      const { count: accounts } = await supabase
        .from("accounts")
        .select("*", {
          count: "exact",
          head: true
        });


      const { count: pendingWithdrawals } =
        await supabase
          .from("withdrawals")
          .select("*", {
            count: "exact",
            head: true
          })
          .eq("status", "pending");


      const { count: pendingTransfers } =
        await supabase
          .from("transfers")
          .select("*", {
            count: "exact",
            head: true
          })
          .in("status", ["pending", "processing"]);


      res.json({
        success: true,
        stats: {
          users: users || 0,
          accounts: accounts || 0,
          pending_withdrawals:
            pendingWithdrawals || 0,
          pending_transfers:
            pendingTransfers || 0
        }
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to load admin statistics"
      });
    }
  }
);


// =====================================================
// ADMIN - USERS
// =====================================================

app.get(
  "/api/admin/users",
  authenticateAdmin,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(`
          *,
          accounts (
            id,
            account_number,
            account_type,
            currency,
            status,
            account_balances (
              available_balance,
              ledger_balance
            )
          )
        `)
        .order("created_at", {
          ascending: false
        });

      if (error) {
        return res.status(500).json({
          success: false,
          message: error.message
        });
      }

      res.json({
        success: true,
        users: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to load users"
      });
    }
  }
);


// =====================================================
// ADMIN - USER DETAILS
// =====================================================

app.get(
  "/api/admin/users/:id",
  authenticateAdmin,
  async (req, res) => {
    try {
      const userId = req.params.id;

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (!profile) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const { data: address } = await supabase
        .from("customer_addresses")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      const { data: accounts } = await supabase
        .from("accounts")
        .select(`
          *,
          account_balances (
            available_balance,
            ledger_balance
          )
        `)
        .eq("user_id", userId);

      const { data: cards } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", userId);

      res.json({
        success: true,
        profile,
        address,
        accounts,
        cards
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to load user"
      });
    }
  }
);


// =====================================================
// ADMIN - WITHDRAWALS
// =====================================================

app.get(
  "/api/admin/withdrawals",
  authenticateAdmin,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("withdrawals")
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (error) {
        return res.status(500).json({
          success: false,
          message: error.message
        });
      }

      res.json({
        success: true,
        withdrawals: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to load withdrawals"
      });
    }
  }
);


// =====================================================
// ADMIN - APPROVE WITHDRAWAL
// =====================================================

app.patch(
  "/api/admin/withdrawals/:id/approve",
  authenticateAdmin,
  async (req, res) => {
    try {
      const withdrawalId = req.params.id;


      const { data: withdrawal } = await supabase
        .from("withdrawals")
        .select("*")
        .eq("id", withdrawalId)
        .maybeSingle();

      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          message: "Withdrawal not found"
        });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: "Withdrawal is no longer pending"
        });
      }


      const { data, error } = await supabase
        .from("withdrawals")
        .update({
          status: "approved",
          reviewed_by: req.user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq("id", withdrawalId)
        .eq("status", "pending")
        .select()
        .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }


      await supabase
        .from("notifications")
        .insert({
          user_id: withdrawal.user_id,
          title: "Withdrawal Approved",
          message:
            `Your withdrawal request for ${withdrawal.amount} ${withdrawal.currency} has been approved.`,
          type: "transaction"
        });


      await supabase
        .from("audit_logs")
        .insert({
          admin_id: req.user.id,
          action: "approve_withdrawal",
          target_type: "withdrawal",
          target_id: withdrawal.id,
          description:
            `Approved withdrawal ${withdrawal.id}`
        });


      res.json({
        success: true,
        message: "Withdrawal approved",
        withdrawal: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to approve withdrawal"
      });
    }
  }
);


// =====================================================
// ADMIN - REJECT WITHDRAWAL
// =====================================================

app.patch(
  "/api/admin/withdrawals/:id/reject",
  authenticateAdmin,
  async (req, res) => {
    try {
      const withdrawalId = req.params.id;

      const { data: withdrawal } = await supabase
        .from("withdrawals")
        .select("*")
        .eq("id", withdrawalId)
        .maybeSingle();

      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          message: "Withdrawal not found"
        });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: "Withdrawal is no longer pending"
        });
      }


      const { data, error } = await supabase
        .from("withdrawals")
        .update({
          status: "rejected",
          reviewed_by: req.user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq("id", withdrawalId)
        .eq("status", "pending")
        .select()
        .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }


      await supabase
        .from("notifications")
        .insert({
          user_id: withdrawal.user_id,
          title: "Withdrawal Rejected",
          message:
            `Your withdrawal request for ${withdrawal.amount} ${withdrawal.currency} was rejected.`,
          type: "transaction"
        });


      await supabase
        .from("audit_logs")
        .insert({
          admin_id: req.user.id,
          action: "reject_withdrawal",
          target_type: "withdrawal",
          target_id: withdrawal.id,
          description:
            `Rejected withdrawal ${withdrawal.id}`
        });


      res.json({
        success: true,
        message: "Withdrawal rejected",
        withdrawal: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to reject withdrawal"
      });
    }
  }
);


// =====================================================
// ADMIN - SUPPORT CONVERSATIONS
// =====================================================

app.get(
  "/api/admin/support/conversations",
  authenticateAdmin,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("support_conversations")
        .select("*")
        .order("updated_at", {
          ascending: false
        });

      if (error) {
        return res.status(500).json({
          success: false,
          message: error.message
        });
      }

      res.json({
        success: true,
        conversations: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to load support conversations"
      });
    }
  }
);


// =====================================================
// ADMIN - SUPPORT MESSAGES
// =====================================================

app.get(
  "/api/admin/support/conversations/:id/messages",
  authenticateAdmin,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .eq("conversation_id", req.params.id)
        .order("created_at", {
          ascending: true
        });

      if (error) {
        return res.status(500).json({
          success: false,
          message: error.message
        });
      }

      res.json({
        success: true,
        messages: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to load messages"
      });
    }
  }
);


// =====================================================
// ADMIN - SEND SUPPORT MESSAGE
// =====================================================

app.post(
  "/api/admin/support/conversations/:id/messages",
  authenticateAdmin,
  async (req, res) => {
    try {
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({
          success: false,
          message: "Message is required"
        });
      }


      const { data: conversation } = await supabase
        .from("support_conversations")
        .select("*")
        .eq("id", req.params.id)
        .maybeSingle();

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }


      const {
        data,
        error
      } = await supabase
        .from("support_messages")
        .insert({
          conversation_id: req.params.id,
          sender_type: "admin",
          sender_id: req.user.id,
          message
        })
        .select()
        .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }


      await supabase
        .from("support_conversations")
        .update({
          updated_at: new Date().toISOString(),
          status: "open"
        })
        .eq("id", req.params.id);


      await supabase
        .from("notifications")
        .insert({
          user_id: conversation.user_id,
          title: "New Support Message",
          message: "You have received a new message from Sterling One Bank Support.",
          type: "system"
        });


      res.status(201).json({
        success: true,
        message: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to send support message"
      });
    }
  }
);


// =====================================================
// ADMIN - CLOSE SUPPORT CONVERSATION
// =====================================================

app.patch(
  "/api/admin/support/conversations/:id/close",
  authenticateAdmin,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("support_conversations")
        .update({
          status: "closed",
          updated_at: new Date().toISOString()
        })
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      res.json({
        success: true,
        message: "Conversation closed",
        conversation: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Unable to close conversation"
      });
    }
  }
);


// =====================================================
// SERVER
// =====================================================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Sterling One Bank API running on port ${PORT}`
  );
});