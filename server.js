require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const supabase = require("./supabase");

console.log(
  "SERVICE ROLE KEY LOADED:",
  !!process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    const authHeader =
      req.headers.authorization || "";
    // -------------------------------------------------
    // CHECK AUTHORIZATION HEADER
    // -------------------------------------------------
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }
    const token =
      authHeader
        .replace("Bearer ", "")
        .trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token missing"
      });
    }
    // -------------------------------------------------
    // VERIFY SUPABASE SESSION
    // -------------------------------------------------
    const {
      data: { user },
      error: authError
    } =
      await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error(
        "ADMIN TOKEN ERROR:",
        authError
      );
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session"
      });
    }
    // -------------------------------------------------
    // GET ADMIN PROFILE
    // -------------------------------------------------
    const {
      data: profile,
      error: profileError
    } =
      await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
    if (profileError) {
      console.error(
        "ADMIN PROFILE CHECK ERROR:",
        profileError
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to verify administrator profile"
      });
    }
    // -------------------------------------------------
    // PROFILE MUST EXIST
    // -------------------------------------------------
    if (!profile) {
      console.error(
        "ADMIN PROFILE NOT FOUND:",
        user.id
      );
      return res.status(403).json({
        success: false,
        message:
          "Administrator profile not found"
      });
    }
    // -------------------------------------------------
    // CHECK ADMIN STATUS
    // -------------------------------------------------
    const isAdmin =
      profile.is_admin === true ||
      profile.is_admin === "true" ||
      profile.is_admin === 1 ||
      profile.is_admin === "1";
    console.log(
      "ADMIN ACCESS CHECK:",
      {
        user_id: user.id,
        email: user.email,
        is_admin_value: profile.is_admin,
        is_admin_type: typeof profile.is_admin,
        is_admin: isAdmin
      }
    );
    if (!isAdmin) {
      console.error(
        "USER IS NOT ADMIN:",
        {
          user_id: user.id,
          email: user.email,
          is_admin: profile.is_admin
        }
      );
      return res.status(403).json({
        success: false,
        message:
          "Administrator access required"
      });
    }
    // -------------------------------------------------
    // ADMIN VERIFIED
    // -------------------------------------------------
    req.user = user;
    req.profile = profile;
    next();
  } catch (error) {
    console.error(
      "ADMIN AUTHENTICATION ERROR:",
      error
    );
    return res.status(500).json({
      success: false,
      message:
        "Admin authentication failed"
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
    phone: phone.trim(),
    ssn: ssn.trim(),
    is_admin: false,
    is_suspended: false
  });

     if (profileError) {
  console.error("PROFILE INSERT ERROR:", profileError);

  await supabase.auth.admin.deleteUser(userId);

  return res.status(500).json({
    success: false,
    message: profileError.message
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

    // -----------------------------
    // Authenticate with Supabase
    // -----------------------------

    const {
      data,
      error
    } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password
    });

    if (error || !data.user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const userId = data.user.id;


    // -----------------------------
    // Get user profile + admin status
    // -----------------------------

    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("profiles")
      .select("id, first_name, surname, is_admin")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error(
        "LOGIN PROFILE ERROR:",
        profileError
      );

      return res.status(500).json({
        success: false,
        message: "Unable to verify account"
      });
    }


    // -----------------------------
    // Determine admin status
    // -----------------------------

    const isAdmin =
      profile &&
      profile.is_admin === true;


    // -----------------------------
    // Return login result
    // -----------------------------

    res.json({
      success: true,
      message: "Login successful",

      session: data.session,

      user: data.user,

      profile: profile || null,

      is_admin: isAdmin
    });

  } catch (error) {
    console.error(
      "Login error:",
      error
    );

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


    // -------------------------------------------------
    // Get profile
    // -------------------------------------------------

    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();


    if (profileError) {

      console.error(
        "AUTH ME PROFILE ERROR:",
        profileError
      );

      return res.status(500).json({
        success: false,
        message: profileError.message
      });

    }


    // -------------------------------------------------
    // Get address
    // -------------------------------------------------

    const {
      data: address,
      error: addressError
    } = await supabase
      .from("customer_addresses")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();


    if (addressError) {

      console.error(
        "AUTH ME ADDRESS ERROR:",
        addressError
      );

    }


    // -------------------------------------------------
    // Get accounts + LIVE balances
    // -------------------------------------------------

    const {
      data: accounts,
      error: accountsError
    } = await supabase
      .from("accounts")
      .select(`
        *,
        account_balances (
          available_balance,
          ledger_balance,
          updated_at
        )
      `)
      .eq("user_id", userId);


    if (accountsError) {

      console.error(
        "AUTH ME ACCOUNTS ERROR:",
        accountsError
      );

      return res.status(500).json({
        success: false,
        message: accountsError.message
      });

    }


    // -------------------------------------------------
    // Find checking account
    // -------------------------------------------------

    const checkingAccount =
      (accounts || []).find(
        account =>
          String(
            account.account_type || ""
          ).toLowerCase() === "checking"
      );


    // -------------------------------------------------
    // Find savings account
    // -------------------------------------------------

    const savingsAccount =
      (accounts || []).find(
        account => {

          const type =
            String(
              account.account_type || ""
            ).toLowerCase();

          return (
            type === "savings" ||
            type === "saving"
          );

        }
      );


    // -------------------------------------------------
    // Read LIVE checking balance
    // -------------------------------------------------

    const checkingBalance =
      Number(
        checkingAccount
          ?.account_balances?.[0]
          ?.available_balance ?? 0
      );


    // -------------------------------------------------
    // Read LIVE savings balance
    // -------------------------------------------------

    const savingsBalance =
      Number(
        savingsAccount
          ?.account_balances?.[0]
          ?.available_balance ?? 0
      );


    // -------------------------------------------------
    // Get LIVE card balance
    // -------------------------------------------------

    const {
      data: cards,
      error: cardsError
    } = await supabase
      .from("cards")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", {
        ascending: false
      });


    if (cardsError) {

      console.error(
        "AUTH ME CARDS ERROR:",
        cardsError
      );

      return res.status(500).json({
        success: false,
        message: cardsError.message
      });

    }


    const card =
      (cards || [])[0] || null;


    const cardBalance =
      Number(
        card?.balance ?? 0
      );


    // -------------------------------------------------
    // Return fresh account information
    // -------------------------------------------------

    res.json({

      success: true,

      user:
        req.user,

      profile:
        profile || null,

      address:
        address || null,

      accounts:
        accounts || [],

      cards:
        cards || [],

      balances: {

        checking:
          checkingBalance,

        savings:
          savingsBalance,

        card:
          cardBalance

      }

    });


  } catch (error) {

    console.error(
      "AUTH ME ERROR:",
      error
    );

    res.status(500).json({

      success: false,

      message:
        "Unable to load user"

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


// ===============================
// GET ALL CUSTOMERS / USERS
// ===============================
app.get("/api/admin/users", authenticateAdmin, async (req, res) => {
  try {
    // 1. Get ALL profiles first.
    // Do NOT use .eq("is_admin", false) here because
    // existing users may have is_admin = NULL.
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (profilesError) {
      console.error("Profiles query error:", profilesError);

      return res.status(500).json({
        success: false,
        message: "Unable to load user profiles.",
        error: profilesError.message
      });
    }

    // 2. Remove administrator profiles in JavaScript.
    const customerProfiles = (profiles || []).filter((profile) => {
      const isAdmin =
        profile.is_admin === true ||
        profile.is_admin === "true" ||
        profile.is_admin === 1 ||
        profile.is_admin === "1";

      return !isAdmin;
    });

    // 3. Get all accounts
    const { data: accounts, error: accountsError } = await supabase
      .from("accounts")
      .select("*");

    if (accountsError) {
      console.error("Accounts query error:", accountsError);

      return res.status(500).json({
        success: false,
        message: "Unable to load accounts.",
        error: accountsError.message
      });
    }

    // 4. Get all account balances
    const { data: accountBalances, error: balancesError } = await supabase
      .from("account_balances")
      .select("*");

    if (balancesError) {
      console.error("Account balances query error:", balancesError);

      return res.status(500).json({
        success: false,
        message: "Unable to load account balances.",
        error: balancesError.message
      });
    }

    // 5. Get authentication users so we can get their emails
    const {
      data: authUsersData,
      error: authUsersError
    } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000
    });

    if (authUsersError) {
      console.error("Auth users query error:", authUsersError);

      return res.status(500).json({
        success: false,
        message: "Unable to load authentication users.",
        error: authUsersError.message
      });
    }

    const authUsers = authUsersData?.users || [];

    // 6. Create quick lookup maps
    const authUserMap = new Map();

    authUsers.forEach((user) => {
      authUserMap.set(user.id, user);
    });

    const accountMap = new Map();

    (accounts || []).forEach((account) => {
      if (account.user_id) {
        accountMap.set(account.user_id, account);
      }
    });

    const balanceMap = new Map();

    (accountBalances || []).forEach((balance) => {
      if (balance.account_id) {
        balanceMap.set(balance.account_id, balance);
      }
    });

    // 7. Build final customer list
    const users = customerProfiles.map((profile) => {
      const authUser = authUserMap.get(profile.id);
      const account = accountMap.get(profile.id);

      const accountBalance = account
        ? balanceMap.get(account.id)
        : null;

      const firstName = profile.first_name || "";
      const surname = profile.surname || "";

      const fullName =
        `${firstName} ${surname}`.trim() ||
        profile.full_name ||
        "Unnamed User";

      const availableBalance =
        accountBalance?.available_balance ??
        accountBalance?.balance ??
        0;

      return {
        id: profile.id,

        full_name: fullName,

        first_name: firstName,
        surname: surname,

        email:
          authUser?.email ||
          profile.email ||
          "No email",

        phone: profile.phone || "",

        balance: Number(availableBalance) || 0,

        is_suspended:
          profile.is_suspended === true ||
          profile.is_suspended === "true" ||
          profile.is_suspended === 1 ||
          profile.is_suspended === "1",

        account: account || null,

        account_balance: accountBalance || null
      };
    });

    console.log(`Admin loaded ${users.length} customer(s)`);

    return res.status(200).json({
      success: true,
      users
    });

  } catch (error) {
    console.error("GET /api/admin/users error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load users.",
      error: error.message
    });
  }
});


// =====================================================
// ADMIN - GET SINGLE USER
// =====================================================

app.get(
  "/api/admin/users/:id",
  authenticateAdmin,
  async (req, res) => {

    try {

      const userId = req.params.id;


      // -------------------------------------------------
      // Get profile
      // -------------------------------------------------

      const {
        data: profile,
        error: profileError
      } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();


      if (profileError) {

        console.error(
          "ADMIN USER PROFILE ERROR:",
          profileError
        );

        return res.status(500).json({
          success: false,
          message: profileError.message
        });

      }


      if (!profile) {

        return res.status(404).json({
          success: false,
          message: "User not found"
        });

      }


      // -------------------------------------------------
      // Get email from Supabase Auth
      // -------------------------------------------------

      const {
        data: authUserData,
        error: authUserError
      } =
        await supabase.auth.admin.getUserById(
          userId
        );


      if (authUserError) {

        console.error(
          "ADMIN USER AUTH ERROR:",
          authUserError
        );

        return res.status(500).json({
          success: false,
          message: authUserError.message
        });

      }


      const authUser =
        authUserData?.user || null;


      // -------------------------------------------------
      // Get address
      // -------------------------------------------------

      const {
        data: address,
        error: addressError
      } = await supabase
        .from("customer_addresses")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();


      if (addressError) {

        console.error(
          "ADMIN USER ADDRESS ERROR:",
          addressError
        );

      }


      // -------------------------------------------------
      // Get accounts
      // -------------------------------------------------

      const {
        data: accounts,
        error: accountsError
      } = await supabase
        .from("accounts")
        .select(`
          id,
          user_id,
          account_number,
          account_type,
          currency,
          status,
          created_at,
          account_balances (
            available_balance,
            ledger_balance
          )
        `)
        .eq("user_id", userId);


      if (accountsError) {

        console.error(
          "ADMIN USER ACCOUNTS ERROR:",
          accountsError
        );

        return res.status(500).json({
          success: false,
          message: accountsError.message
        });

      }


      // -------------------------------------------------
      // Get cards
      // -------------------------------------------------

      const {
        data: cards,
        error: cardsError
      } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", userId);


      if (cardsError) {

        console.error(
          "ADMIN USER CARDS ERROR:",
          cardsError
        );

        return res.status(500).json({
          success: false,
          message: cardsError.message
        });

      }


      // -------------------------------------------------
      // Find checking account
      // -------------------------------------------------

      const checkingAccount =
        (accounts || []).find(
          account =>
            String(
              account.account_type || ""
            ).toLowerCase() === "checking"
        );


      // -------------------------------------------------
      // Find savings account
      // -------------------------------------------------

      const savingsAccount =
        (accounts || []).find(
          account =>
            String(
              account.account_type || ""
            ).toLowerCase() === "savings"
        );


      // -------------------------------------------------
      // Get balances
      // -------------------------------------------------

      const checkingBalance =
        Number(
          checkingAccount
            ?.account_balances?.[0]
            ?.available_balance ?? 0
        );


      const savingsBalance =
        Number(
          savingsAccount
            ?.account_balances?.[0]
            ?.available_balance ?? 0
        );


      // -------------------------------------------------
      // Get card balance
      // -------------------------------------------------

      const card =
        (cards || [])[0] || null;


      const cardBalance =
        Number(
          card?.balance ?? 0
        );


      // -------------------------------------------------
      // Build full name
      // -------------------------------------------------

      const fullName = [

        profile.first_name,

        profile.surname

      ]
      .filter(Boolean)
      .join(" ")
      .trim();


      // -------------------------------------------------
      // Return user
      // -------------------------------------------------

      res.json({

        success: true,

        profile: {

          ...profile,

          full_name:
            fullName ||
            "Unnamed User",

          email:
            authUser?.email ||
            profile.email ||
            "No email"

        },

        address:
          address || null,

        accounts:
          accounts || [],

        cards:
          cards || [],

        balances: {

          checking:
            checkingBalance,

          savings:
            savingsBalance,

          card:
            cardBalance

        }

      });


    } catch (error) {

      console.error(
        "ADMIN USER DETAILS ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Unable to load user"
      });

    }

  }
);

// =====================================================
// ADMIN - UPDATE USER ACCOUNT BALANCES
// =====================================================

app.put(
  "/api/admin/users/:id/balances",
  authenticateAdmin,
  async (req, res) => {

    try {

      const userId = req.params.id;

      const {
        checking_balance,
        savings_balance,
        card_balance
      } = req.body;


      // -------------------------------------------------
      // VALIDATE BALANCES
      // -------------------------------------------------

      const checking = Number(checking_balance);
      const savings = Number(savings_balance);
      const card = Number(card_balance);


      if (
        !Number.isFinite(checking) ||
        !Number.isFinite(savings) ||
        !Number.isFinite(card)
      ) {

        return res.status(400).json({
          success: false,
          message: "Invalid balance amount"
        });

      }


      if (
        checking < 0 ||
        savings < 0 ||
        card < 0
      ) {

        return res.status(400).json({
          success: false,
          message: "Balance cannot be negative"
        });

      }


      // -------------------------------------------------
      // VERIFY TARGET USER
      // -------------------------------------------------

      const {
        data: profile,
        error: profileError
      } = await supabase
        .from("profiles")
        .select("id, is_admin")
        .eq("id", userId)
        .maybeSingle();


      if (profileError) {

        console.error(
          "BALANCE UPDATE PROFILE ERROR:",
          profileError
        );

        return res.status(500).json({
          success: false,
          message: profileError.message
        });

      }


      if (!profile) {

        return res.status(404).json({
          success: false,
          message: "User not found"
        });

      }


      // Never allow modifying another admin
      if (profile.is_admin === true) {

        return res.status(403).json({
          success: false,
          message:
            "Administrator balances cannot be modified here"
        });

      }


      // -------------------------------------------------
      // GET ALL USER ACCOUNTS
      // -------------------------------------------------

      const {
        data: accounts,
        error: accountsError
      } = await supabase
        .from("accounts")
        .select("*")
        .eq("user_id", userId);


      if (accountsError) {

        console.error(
          "BALANCE UPDATE ACCOUNTS ERROR:",
          accountsError
        );

        return res.status(500).json({
          success: false,
          message: accountsError.message
        });

      }


      // -------------------------------------------------
      // FIND CHECKING ACCOUNT
      // -------------------------------------------------

      let checkingAccount =
        (accounts || []).find(account =>
          String(account.account_type || "")
            .toLowerCase() === "checking"
        );


      // -------------------------------------------------
      // FIND SAVINGS ACCOUNT
      // Accept both "savings" and "saving"
      // -------------------------------------------------

      let savingsAccount =
        (accounts || []).find(account => {

          const type =
            String(account.account_type || "")
              .toLowerCase();

          return (
            type === "savings" ||
            type === "saving"
          );

        });


      // -------------------------------------------------
      // CHECKING ACCOUNT
      // -------------------------------------------------

      if (!checkingAccount) {

        return res.status(400).json({
          success: false,
          message: "Checking account not found"
        });

      }


      // -------------------------------------------------
      // UPDATE CHECKING BALANCE
      // -------------------------------------------------

      const {
        error: checkingUpdateError
      } = await supabase
        .from("account_balances")
        .update({
          available_balance: checking,
          ledger_balance: checking,
          updated_at: new Date().toISOString()
        })
        .eq(
          "account_id",
          checkingAccount.id
        );


      if (checkingUpdateError) {

        console.error(
          "CHECKING BALANCE UPDATE ERROR:",
          checkingUpdateError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to update checking balance: " +
            checkingUpdateError.message
        });

      }


      // -------------------------------------------------
      // SAVINGS ACCOUNT
      //
      // If user doesn't have one yet, create it.
      // -------------------------------------------------

      if (savingsAccount) {

        const {
          error: savingsUpdateError
        } = await supabase
          .from("account_balances")
          .update({
            available_balance: savings,
            ledger_balance: savings,
            updated_at: new Date().toISOString()
          })
          .eq(
            "account_id",
            savingsAccount.id
          );


        if (savingsUpdateError) {

          console.error(
            "SAVINGS BALANCE UPDATE ERROR:",
            savingsUpdateError
          );

          return res.status(500).json({
            success: false,
            message:
              "Unable to update savings balance: " +
              savingsUpdateError.message
          });

        }

      } else {

        // -------------------------------------------------
        // CREATE SAVINGS ACCOUNT
        // -------------------------------------------------

        const savingsAccountNumber =
          await generateAccountNumber();


        const {
          data: newSavingsAccount,
          error: savingsAccountError
        } = await supabase
          .from("accounts")
          .insert({
            user_id: userId,
            account_number: savingsAccountNumber,
            account_type: "savings",
            currency: "USD",
            status: "active"
          })
          .select()
          .single();


        if (savingsAccountError) {

          console.error(
            "SAVINGS ACCOUNT CREATION ERROR:",
            savingsAccountError
          );

          return res.status(500).json({
            success: false,
            message:
              "Unable to create savings account: " +
              savingsAccountError.message
          });

        }


        // -------------------------------------------------
        // CREATE SAVINGS BALANCE
        // -------------------------------------------------

        const {
          error: savingsBalanceError
        } = await supabase
          .from("account_balances")
          .insert({
            account_id: newSavingsAccount.id,
            available_balance: savings,
            ledger_balance: savings,
            updated_at: new Date().toISOString()
          });


        if (savingsBalanceError) {

          console.error(
            "SAVINGS BALANCE CREATION ERROR:",
            savingsBalanceError
          );

          return res.status(500).json({
            success: false,
            message:
              "Unable to create savings balance: " +
              savingsBalanceError.message
          });

        }

      }


      // -------------------------------------------------
      // CARD BALANCE
      // -------------------------------------------------

      const {
        data: cards,
        error: cardsError
      } = await supabase
        .from("cards")
        .select("id")
        .eq("user_id", userId);


      if (cardsError) {

        console.error(
          "CARD LOOKUP ERROR:",
          cardsError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to check card: " +
            cardsError.message
        });

      }


      // Update all existing cards belonging to user
      if (cards && cards.length > 0) {

        const {
          error: cardUpdateError
        } = await supabase
          .from("cards")
          .update({
            balance: card
          })
          .eq(
            "user_id",
            userId
          );


        if (cardUpdateError) {

          console.error(
            "CARD BALANCE UPDATE ERROR:",
            cardUpdateError
          );

          return res.status(500).json({
            success: false,
            message:
              "Unable to update card balance: " +
              cardUpdateError.message
          });

        }

      }


      // -------------------------------------------------
      // VERIFY FINAL BALANCES
      // -------------------------------------------------

      const {
        data: finalAccounts,
        error: finalAccountsError
      } = await supabase
        .from("accounts")
        .select(`
          id,
          account_type,
          account_balances (
            available_balance,
            ledger_balance,
            updated_at
          )
        `)
        .eq("user_id", userId);


      if (finalAccountsError) {

        console.error(
          "FINAL BALANCE CHECK ERROR:",
          finalAccountsError
        );

        return res.status(500).json({
          success: false,
          message: finalAccountsError.message
        });

      }


      const finalChecking =
        (finalAccounts || []).find(account =>
          String(account.account_type || "")
            .toLowerCase() === "checking"
        );


      const finalSavings =
        (finalAccounts || []).find(account => {

          const type =
            String(account.account_type || "")
              .toLowerCase();

          return (
            type === "savings" ||
            type === "saving"
          );

        });


      const {
        data: finalCards
      } = await supabase
        .from("cards")
        .select("balance")
        .eq("user_id", userId);


      const finalCard =
        finalCards?.[0]?.balance ?? 0;


      // -------------------------------------------------
      // SUCCESS
      // -------------------------------------------------

      res.json({

        success: true,

        message:
          "User balances updated successfully",

        balances: {

          checking:
            Number(
              finalChecking
                ?.account_balances?.[0]
                ?.available_balance ?? 0
            ),

          savings:
            Number(
              finalSavings
                ?.account_balances?.[0]
                ?.available_balance ?? 0
            ),

          card:
            Number(finalCard)

        }

      });


    } catch (error) {

      console.error(
        "ADMIN BALANCE UPDATE ERROR:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "Unable to update user balances"

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