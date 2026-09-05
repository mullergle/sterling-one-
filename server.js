require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const supabase = require("./supabase");

const app = express();

/* =====================================================
   CONFIG
===================================================== */

const PORT = process.env.PORT || 5000;

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("WARNING: SUPABASE_SERVICE_ROLE_KEY is missing");
}

console.log(
  "SERVICE ROLE KEY LOADED:",
  !!process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json({ limit: "2mb" }));

/* =====================================================
   BASIC
===================================================== */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Sterling One Bank API is running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API healthy",
    timestamp: new Date().toISOString()
  });
});

/* =====================================================
   SUPABASE TEST
===================================================== */

app.get("/api/test-supabase", async (req, res) => {
  try {
    const { error } = await supabase
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) {
      console.error("SUPABASE TEST ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Supabase connection failed",
        error: error.message
      });
    }

    return res.json({
      success: true,
      message: "Supabase connection successful"
    });
  } catch (error) {
    console.error("SUPABASE TEST EXCEPTION:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/* =====================================================
   HELPERS
===================================================== */

function generateReference(prefix = "STL") {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}

function isAdminValue(value) {
  if (value === true) return true;
  if (value === 1) return true;
  if (value === "1") return true;

  return String(value || "")
    .trim()
    .toLowerCase() === "true";
}

function isSuspendedValue(value) {
  if (value === true) return true;
  if (value === 1) return true;
  if (value === "1") return true;

  return String(value || "")
    .trim()
    .toLowerCase() === "true";
}

async function generateAccountNumber() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const number =
      "4" +
      Math.floor(100000000 + Math.random() * 900000000);

    const { data, error } = await supabase
      .from("accounts")
      .select("id")
      .eq("account_number", number)
      .maybeSingle();

    if (error) {
      console.error(
        "ACCOUNT NUMBER CHECK ERROR:",
        error
      );

      throw new Error(
        "Unable to generate account number"
      );
    }

    if (!data) {
      return number;
    }
  }

  throw new Error(
    "Unable to generate unique account number"
  );
}

/* =====================================================
   AUTHENTICATION
===================================================== */

async function authenticate(req, res, next) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    const token =
      authorization.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token missing"
      });
    }

    const {
      data,
      error
    } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      console.error(
        "AUTHENTICATION ERROR:",
        error
      );

      return res.status(401).json({
        success: false,
        message: "Invalid or expired session"
      });
    }

    req.user = data.user;
    req.accessToken = token;

    next();
  } catch (error) {
    console.error(
      "AUTHENTICATION EXCEPTION:",
      error
    );

    return res.status(401).json({
      success: false,
      message: "Authentication failed"
    });
  }
}

/* =====================================================
   ADMIN AUTHENTICATION
===================================================== */

async function authenticateAdmin(req, res, next) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    const token =
      authorization.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token missing"
      });
    }

    const {
      data: authData,
      error: authError
    } = await supabase.auth.getUser(token);

    if (authError || !authData?.user) {
      console.error(
        "ADMIN AUTH ERROR:",
        authError
      );

      return res.status(401).json({
        success: false,
        message: "Invalid or expired session"
      });
    }

    const user =
      authData.user;

    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error(
        "ADMIN PROFILE ERROR:",
        profileError
      );

      return res.status(500).json({
        success: false,
        message: "Unable to verify administrator profile"
      });
    }

    if (!profile) {
      return res.status(403).json({
        success: false,
        message: "Administrator profile not found"
      });
    }

    if (!isAdminValue(profile.is_admin)) {
      return res.status(403).json({
        success: false,
        message: "Administrator access required"
      });
    }

    if (isSuspendedValue(profile.is_suspended)) {
      return res.status(403).json({
        success: false,
        message: "Administrator account is suspended"
      });
    }

    req.user = user;
    req.profile = profile;
    req.accessToken = token;

    next();
  } catch (error) {
    console.error(
      "ADMIN AUTH EXCEPTION:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Admin authentication failed"
    });
  }
}

/* =====================================================
   REGISTER
===================================================== */

app.post("/api/auth/register", async (req, res) => {
  let createdUserId = null;

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
    } = req.body || {};

    const cleanEmail =
      String(email || "")
        .trim()
        .toLowerCase();

    if (
      !fname ||
      !sname ||
      !cleanEmail ||
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

    if (terms !== true) {
      return res.status(400).json({
        success: false,
        message:
          "You must accept the terms and conditions"
      });
    }

    if (pass !== cpass) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match"
      });
    }

    if (String(pass).length < 8) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters"
      });
    }

    /* ---------------------------------------------
       CREATE SUPABASE AUTH USER
    --------------------------------------------- */

    const {
      data: authData,
      error: authError
    } =
      await supabase.auth.admin.createUser({
        email: cleanEmail,
        password: pass,
        email_confirm: true
      });

    if (authError || !authData?.user) {
      console.error(
        "CREATE AUTH USER ERROR:",
        authError
      );

      return res.status(400).json({
        success: false,
        message:
          authError?.message ||
          "Unable to create account"
      });
    }

    createdUserId =
      authData.user.id;

    /* ---------------------------------------------
       CREATE PROFILE
    --------------------------------------------- */

    const {
      error: profileError
    } = await supabase
      .from("profiles")
      .insert({
        id: createdUserId,
        first_name: String(fname).trim(),
        surname: String(sname).trim(),
        phone: String(phone).trim(),
        ssn: ssn
          ? String(ssn).trim()
          : null,

        /* IMPORTANT */
        is_admin: false,
        is_suspended: false
      });

    if (profileError) {
      console.error(
        "PROFILE INSERT ERROR:",
        profileError
      );

      await supabase.auth.admin.deleteUser(
        createdUserId
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to create customer profile",
        error: profileError.message
      });
    }

    /* ---------------------------------------------
       ADDRESS
    --------------------------------------------- */

    const {
      error: addressError
    } = await supabase
      .from("customer_addresses")
      .insert({
        user_id: createdUserId,
        country: String(country).trim(),
        state: String(state).trim(),
        city: String(city).trim(),
        house_address: String(address).trim()
      });

    if (addressError) {
      console.error(
        "ADDRESS INSERT ERROR:",
        addressError
      );

      await supabase.auth.admin.deleteUser(
        createdUserId
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to save customer address",
        error: addressError.message
      });
    }

    /* ---------------------------------------------
       ACCOUNT
    --------------------------------------------- */

    const accountNumber =
      await generateAccountNumber();

    const {
      data: account,
      error: accountError
    } = await supabase
      .from("accounts")
      .insert({
        user_id: createdUserId,
        account_number: accountNumber,
        account_type: "checking",
        currency: "USD",
        status: "active"
      })
      .select()
      .single();

    if (accountError || !account) {
      console.error(
        "ACCOUNT CREATION ERROR:",
        accountError
      );

      await supabase.auth.admin.deleteUser(
        createdUserId
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to create bank account",
        error:
          accountError?.message
      });
    }

    /* ---------------------------------------------
       ACCOUNT BALANCE
    --------------------------------------------- */

    const {
      error: balanceError
    } = await supabase
      .from("account_balances")
      .insert({
        account_id: account.id,
        available_balance: 0,
        ledger_balance: 0
      });

    if (balanceError) {
      console.error(
        "BALANCE CREATION ERROR:",
        balanceError
      );

      await supabase.auth.admin.deleteUser(
        createdUserId
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to create account balance",
        error: balanceError.message
      });
    }

    /* ---------------------------------------------
       OPTIONAL DATA
       
       These MUST NOT make registration fail.
    --------------------------------------------- */

    try {
      await supabase
        .from("customer_consents")
        .insert({
          user_id: createdUserId,
          consent_type: "terms",
          version: "1.0"
        });
    } catch (error) {
      console.error(
        "TERMS CONSENT ERROR:",
        error
      );
    }

    try {
      await supabase
        .from("customer_consents")
        .insert({
          user_id: createdUserId,
          consent_type: "privacy",
          version: "1.0"
        });
    } catch (error) {
      console.error(
        "PRIVACY CONSENT ERROR:",
        error
      );
    }

    try {
      await supabase
        .from("notifications")
        .insert({
          user_id: createdUserId,
          title:
            "Welcome to Sterling One Bank",
          message:
            "Your Sterling One Bank account has been created successfully.",
          type: "account"
        });
    } catch (error) {
      console.error(
        "WELCOME NOTIFICATION ERROR:",
        error
      );
    }

    return res.status(201).json({
      success: true,
      message: "Registration successful",

      user_id:
        createdUserId,

      account_number:
        accountNumber,

      user: {
        id:
          createdUserId,
        email:
          cleanEmail
      }
    });
  } catch (error) {
    console.error(
      "REGISTRATION ERROR:",
      error
    );

    if (createdUserId) {
      try {
        await supabase.auth.admin.deleteUser(
          createdUserId
        );
      } catch (cleanupError) {
        console.error(
          "REGISTRATION CLEANUP ERROR:",
          cleanupError
        );
      }
    }

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Unable to complete registration"
    });
  }
});

/* =====================================================
   LOGIN
===================================================== */

app.post("/api/auth/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body || {};

    const cleanEmail =
      String(email || "")
        .trim()
        .toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Email and password are required"
      });
    }

    const {
      data,
      error
    } =
      await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password
      });

    if (error || !data?.user || !data?.session) {
      console.error(
        "LOGIN AUTH ERROR:",
        error
      );

      return res.status(401).json({
        success: false,
        message:
          "Invalid email or password"
      });
    }

    const user =
      data.user;

    /* ---------------------------------------------
       LOAD PROFILE
    --------------------------------------------- */

    const {
      data: profile,
      error: profileError
    } =
      await supabase
        .from("profiles")
        .select(
          "id, first_name, surname, phone, is_admin, is_suspended"
        )
        .eq("id", user.id)
        .maybeSingle();

    if (profileError) {
      console.error(
        "LOGIN PROFILE ERROR:",
        profileError
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to verify account",
        error:
          profileError.message
      });
    }

    if (!profile) {
      return res.status(403).json({
        success: false,
        message:
          "User profile not found"
      });
    }

    const isAdmin =
      isAdminValue(profile.is_admin);

    const isSuspended =
      isSuspendedValue(
        profile.is_suspended
      );

    if (isSuspended) {
      return res.status(403).json({
        success: false,
        message:
          "This account has been suspended"
      });
    }

    /*
      IMPORTANT:
      Return the token in several common locations.

      This prevents a frontend expecting
      access_token/token from failing after
      successful Supabase authentication.
    */

    return res.json({
      success: true,
      message: "Login successful",

      session:
        data.session,

      access_token:
        data.session.access_token,

      refresh_token:
        data.session.refresh_token,

      token:
        data.session.access_token,

      expires_at:
        data.session.expires_at,

      expires_in:
        data.session.expires_in,

      user,

      profile,

      is_admin:
        isAdmin
    });
  } catch (error) {
    console.error(
      "LOGIN ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to login",
      error:
        error.message
    });
  }
});

/* =====================================================
   CURRENT USER
===================================================== */

app.get(
  "/api/auth/me",
  authenticate,
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      /* ---------------------------------------------
         PROFILE
      --------------------------------------------- */

      const {
        data: profile,
        error: profileError
      } =
        await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle();

      if (profileError) {
        console.error(
          "ME PROFILE ERROR:",
          profileError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to load profile",
          error:
            profileError.message
        });
      }

      if (!profile) {
        return res.status(404).json({
          success: false,
          message:
            "Profile not found"
        });
      }

      /* ---------------------------------------------
         ADDRESS
      --------------------------------------------- */

      let address = null;

      try {
        const result =
          await supabase
            .from("customer_addresses")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();

        if (!result.error) {
          address =
            result.data || null;
        } else {
          console.error(
            "ME ADDRESS ERROR:",
            result.error
          );
        }
      } catch (error) {
        console.error(
          "ME ADDRESS EXCEPTION:",
          error
        );
      }

      /* ---------------------------------------------
         ACCOUNTS
      --------------------------------------------- */

      const {
        data: accounts,
        error: accountsError
      } =
        await supabase
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
          "ME ACCOUNTS ERROR:",
          accountsError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to load accounts",
          error:
            accountsError.message
        });
      }

      const accountList =
        accounts || [];

      const checkingAccount =
        accountList.find(
          account =>
            String(
              account.account_type || ""
            ).toLowerCase() ===
            "checking"
        );

      const savingsAccount =
        accountList.find(
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

      /* ---------------------------------------------
         CARDS

         OPTIONAL.

         A cards-table problem must NOT break login.
      --------------------------------------------- */

      let cards = [];

      try {
        const result =
          await supabase
            .from("cards")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", {
              ascending: false
            });

        if (!result.error) {
          cards =
            result.data || [];
        } else {
          console.error(
            "ME CARDS ERROR:",
            result.error
          );
        }
      } catch (error) {
        console.error(
          "ME CARDS EXCEPTION:",
          error
        );
      }

      const card =
        cards[0] || null;

      const cardBalance =
        Number(
          card?.balance ?? 0
        );

      return res.json({
        success: true,

        user:
          req.user,

        profile,

        address,

        accounts:
          accountList,

        cards,

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

      return res.status(500).json({
        success: false,
        message:
          "Unable to load user",
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   FORGOT PASSWORD
===================================================== */

app.post(
  "/api/auth/forgot-password",
  async (req, res) => {
    try {
      const { email } =
        req.body || {};

      const cleanEmail =
        String(email || "")
          .trim()
          .toLowerCase();

      if (!cleanEmail) {
        return res.status(400).json({
          success: false,
          message:
            "Email is required"
        });
      }

      const { error } =
        await supabase.auth
          .resetPasswordForEmail(
            cleanEmail
          );

      if (error) {
        console.error(
          "PASSWORD RESET ERROR:",
          error
        );
      }

      return res.json({
        success: true,
        message:
          "If an account exists for this email, password reset instructions have been sent."
      });
    } catch (error) {
      console.error(
        "FORGOT PASSWORD ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to process password reset"
      });
    }
  }
);

/* =====================================================
   ACCOUNTS
===================================================== */

app.get(
  "/api/accounts",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("accounts")
          .select(`
            *,
            account_balances (
              available_balance,
              ledger_balance,
              updated_at
            )
          `)
          .eq(
            "user_id",
            req.user.id
          );

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        accounts:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load accounts"
      });
    }
  }
);

/* =====================================================
   ACCOUNT DETAILS
===================================================== */

app.get(
  "/api/accounts/:id",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("accounts")
          .select(`
            *,
            account_balances (
              available_balance,
              ledger_balance,
              updated_at
            )
          `)
          .eq(
            "id",
            req.params.id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .maybeSingle();

      if (error || !data) {
        return res.status(404).json({
          success: false,
          message:
            "Account not found"
        });
      }

      return res.json({
        success: true,
        account:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load account"
      });
    }
  }
);

/* =====================================================
   TRANSACTIONS
===================================================== */

app.get(
  "/api/transactions",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("transactions")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order("created_at", {
            ascending: false
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        transactions:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load transactions"
      });
    }
  }
);

/* =====================================================
   BENEFICIARIES
===================================================== */

app.get(
  "/api/beneficiaries",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("beneficiaries")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order("created_at", {
            ascending: false
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        beneficiaries:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load beneficiaries"
      });
    }
  }
);

app.post(
  "/api/beneficiaries",
  authenticate,
  async (req, res) => {
    try {
      const {
        name,
        bank_name,
        account_identifier,
        account_type
      } = req.body || {};

      if (
        !name ||
        !bank_name ||
        !account_identifier
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Required beneficiary information is missing"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("beneficiaries")
          .insert({
            user_id:
              req.user.id,
            name:
              String(name).trim(),
            bank_name:
              String(bank_name).trim(),
            account_identifier:
              String(
                account_identifier
              ).trim(),
            account_type:
              account_type ||
              "checking"
          })
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      return res.status(201).json({
        success: true,
        message:
          "Beneficiary added",
        beneficiary:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to create beneficiary"
      });
    }
  }
);

app.delete(
  "/api/beneficiaries/:id",
  authenticate,
  async (req, res) => {
    try {
      const {
        error
      } =
        await supabase
          .from("beneficiaries")
          .delete()
          .eq(
            "id",
            req.params.id
          )
          .eq(
            "user_id",
            req.user.id
          );

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        message:
          "Beneficiary deleted"
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to delete beneficiary"
      });
    }
  }
);

/* =====================================================
   TRANSFERS
===================================================== */

app.post(
  "/api/transfers",
  authenticate,
  async (req, res) => {
    try {
      const {
        sender_account_id,
        beneficiary_id,
        amount
      } = req.body || {};

      if (
        !sender_account_id ||
        !beneficiary_id ||
        amount === undefined ||
        amount === null
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Account, beneficiary and amount are required"
        });
      }

      const transferAmount =
        Number(amount);

      if (
        !Number.isFinite(
          transferAmount
        ) ||
        transferAmount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid transfer amount"
        });
      }

      const {
        data: account
      } =
        await supabase
          .from("accounts")
          .select("*")
          .eq(
            "id",
            sender_account_id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .maybeSingle();

      if (!account) {
        return res.status(404).json({
          success: false,
          message:
            "Sender account not found"
        });
      }

      const {
        data: beneficiary
      } =
        await supabase
          .from("beneficiaries")
          .select("*")
          .eq(
            "id",
            beneficiary_id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .maybeSingle();

      if (!beneficiary) {
        return res.status(404).json({
          success: false,
          message:
            "Beneficiary not found"
        });
      }

      if (
        beneficiary.status &&
        beneficiary.status !== "active"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Beneficiary is not active"
        });
      }

      const {
        data: balance
      } =
        await supabase
          .from("account_balances")
          .select("*")
          .eq(
            "account_id",
            sender_account_id
          )
          .maybeSingle();

      if (!balance) {
        return res.status(404).json({
          success: false,
          message:
            "Account balance not found"
        });
      }

      if (
        Number(
          balance.available_balance
        ) < transferAmount
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Insufficient funds"
        });
      }

      const reference =
        generateReference("TRF");

      const {
        data: transfer,
        error
      } =
        await supabase
          .from("transfers")
          .insert({
            sender_user_id:
              req.user.id,
            sender_account_id,
            beneficiary_id,
            amount:
              transferAmount,
            currency:
              account.currency,
            reference,
            status:
              "pending"
          })
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      return res.status(201).json({
        success: true,
        message:
          "Transfer submitted for processing",
        transfer
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to create transfer"
      });
    }
  }
);

/* =====================================================
   WITHDRAWALS
===================================================== */

app.post(
  "/api/withdrawals",
  authenticate,
  async (req, res) => {
    try {
      const {
        account_id,
        amount,
        destination,
        reason
      } = req.body || {};

      if (
        !account_id ||
        amount === undefined ||
        amount === null
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Account and amount are required"
        });
      }

      const withdrawalAmount =
        Number(amount);

      if (
        !Number.isFinite(
          withdrawalAmount
        ) ||
        withdrawalAmount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid withdrawal amount"
        });
      }

      const {
        data: account
      } =
        await supabase
          .from("accounts")
          .select("*")
          .eq(
            "id",
            account_id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .maybeSingle();

      if (!account) {
        return res.status(404).json({
          success: false,
          message:
            "Account not found"
        });
      }

      const {
        data: balance
      } =
        await supabase
          .from("account_balances")
          .select("*")
          .eq(
            "account_id",
            account_id
          )
          .maybeSingle();

      if (!balance) {
        return res.status(404).json({
          success: false,
          message:
            "Account balance not found"
        });
      }

      if (
        Number(
          balance.available_balance
        ) < withdrawalAmount
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Insufficient funds"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("withdrawals")
          .insert({
            user_id:
              req.user.id,
            account_id,
            amount:
              withdrawalAmount,
            currency:
              account.currency,
            destination:
              destination || null,
            reason:
              reason || null,
            status:
              "pending"
          })
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      return res.status(201).json({
        success: true,
        message:
          "Withdrawal request submitted",
        withdrawal:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to create withdrawal"
      });
    }
  }
);

app.get(
  "/api/withdrawals",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("withdrawals")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order("created_at", {
            ascending: false
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        withdrawals:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load withdrawals"
      });
    }
  }
);

/* =====================================================
   CARDS
===================================================== */

app.get(
  "/api/cards",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("cards")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order("created_at", {
            ascending: false
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        cards:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load cards"
      });
    }
  }
);

/* =====================================================
   NOTIFICATIONS
===================================================== */

app.get(
  "/api/notifications",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("notifications")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order("created_at", {
            ascending: false
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        notifications:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load notifications"
      });
    }
  }
);

app.patch(
  "/api/notifications/:id/read",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("notifications")
          .update({
            read_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            req.params.id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .select()
          .maybeSingle();

      if (error || !data) {
        return res.status(404).json({
          success: false,
          message:
            "Notification not found"
        });
      }

      return res.json({
        success: true,
        notification:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to update notification"
      });
    }
  }
);

/* =====================================================
   SUPPORT - CUSTOMER
===================================================== */

app.post(
  "/api/support/conversations",
  authenticate,
  async (req, res) => {
    try {
      const {
        subject,
        message
      } = req.body || {};

      if (!subject || !message) {
        return res.status(400).json({
          success: false,
          message:
            "Subject and message are required"
        });
      }

      const {
        data: conversation,
        error: conversationError
      } =
        await supabase
          .from("support_conversations")
          .insert({
            user_id:
              req.user.id,
            subject:
              String(subject).trim(),
            status:
              "open"
          })
          .select()
          .single();

      if (conversationError) {
        return res.status(400).json({
          success: false,
          message:
            conversationError.message
        });
      }

      const {
        data: supportMessage,
        error: messageError
      } =
        await supabase
          .from("support_messages")
          .insert({
            conversation_id:
              conversation.id,
            sender_type:
              "customer",
            sender_id:
              req.user.id,
            message:
              String(message).trim()
          })
          .select()
          .single();

      if (messageError) {
        return res.status(400).json({
          success: false,
          message:
            messageError.message
        });
      }

      return res.status(201).json({
        success: true,
        conversation,
        message:
          supportMessage
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to create support conversation"
      });
    }
  }
);

app.get(
  "/api/support/conversations",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("support_conversations")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order("updated_at", {
            ascending: false
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        conversations:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load support conversations"
      });
    }
  }
);

app.get(
  "/api/support/conversations/:id/messages",
  authenticate,
  async (req, res) => {
    try {
      const {
        data: conversation
      } =
        await supabase
          .from("support_conversations")
          .select("id")
          .eq(
            "id",
            req.params.id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .maybeSingle();

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message:
            "Conversation not found"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("support_messages")
          .select("*")
          .eq(
            "conversation_id",
            req.params.id
          )
          .order("created_at", {
            ascending: true
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        messages:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load messages"
      });
    }
  }
);

app.post(
  "/api/support/conversations/:id/messages",
  authenticate,
  async (req, res) => {
    try {
      const {
        message
      } = req.body || {};

      if (!message) {
        return res.status(400).json({
          success: false,
          message:
            "Message is required"
        });
      }

      const {
        data: conversation
      } =
        await supabase
          .from("support_conversations")
          .select("id")
          .eq(
            "id",
            req.params.id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .maybeSingle();

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message:
            "Conversation not found"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("support_messages")
          .insert({
            conversation_id:
              req.params.id,
            sender_type:
              "customer",
            sender_id:
              req.user.id,
            message:
              String(message).trim()
          })
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      await supabase
        .from("support_conversations")
        .update({
          updated_at:
            new Date().toISOString(),
          status:
            "open"
        })
        .eq(
          "id",
          req.params.id
        )
        .eq(
          "user_id",
          req.user.id
        );

      return res.status(201).json({
        success: true,
        message:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to send message"
      });
    }
  }
);

/* =====================================================
   ADMIN STATS
===================================================== */

app.get(
  "/api/admin/stats",
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        count: users,
        error: usersError
      } =
        await supabase
          .from("profiles")
          .select("*", {
            count: "exact",
            head: true
          });

      if (usersError) {
        throw usersError;
      }

      const {
        count: accounts,
        error: accountsError
      } =
        await supabase
          .from("accounts")
          .select("*", {
            count: "exact",
            head: true
          });

      if (accountsError) {
        throw accountsError;
      }

      const {
        count: pendingWithdrawals,
        error: withdrawalsError
      } =
        await supabase
          .from("withdrawals")
          .select("*", {
            count: "exact",
            head: true
          })
          .eq(
            "status",
            "pending"
          );

      if (withdrawalsError) {
        throw withdrawalsError;
      }

      const {
        count: pendingTransfers,
        error: transfersError
      } =
        await supabase
          .from("transfers")
          .select("*", {
            count: "exact",
            head: true
          })
          .in(
            "status",
            [
              "pending",
              "processing"
            ]
          );

      if (transfersError) {
        throw transfersError;
      }

      return res.json({
        success: true,

        stats: {
          users:
            users || 0,

          accounts:
            accounts || 0,

          pending_withdrawals:
            pendingWithdrawals || 0,

          pending_transfers:
            pendingTransfers || 0
        }
      });
    } catch (error) {
      console.error(
        "ADMIN STATS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load admin statistics",
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN USERS
===================================================== */

app.get(
  "/api/admin/users",
  authenticateAdmin,
  async (req, res) => {
    try {
      console.log(
        "ADMIN USERS REQUEST:",
        req.user.email
      );

      /* ---------------------------------------------
         PROFILES
      --------------------------------------------- */

      const {
        data: profiles,
        error: profilesError
      } =
        await supabase
          .from("profiles")
          .select("*")
          .order("created_at", {
            ascending: false
          });

      if (profilesError) {
        console.error(
          "ADMIN USERS PROFILE ERROR:",
          profilesError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to load user profiles",
          error:
            profilesError.message
        });
      }

      /* ---------------------------------------------
         ACCOUNTS
      --------------------------------------------- */

      const {
        data: accounts,
        error: accountsError
      } =
        await supabase
          .from("accounts")
          .select("*");

      if (accountsError) {
        console.error(
          "ADMIN USERS ACCOUNTS ERROR:",
          accountsError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to load accounts",
          error:
            accountsError.message
        });
      }

      /* ---------------------------------------------
         BALANCES
      --------------------------------------------- */

      const {
        data: balances,
        error: balancesError
      } =
        await supabase
          .from("account_balances")
          .select("*");

      if (balancesError) {
        console.error(
          "ADMIN USERS BALANCE ERROR:",
          balancesError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to load account balances",
          error:
            balancesError.message
        });
      }

      /* ---------------------------------------------
         AUTH USERS
      --------------------------------------------- */

      let authUsers = [];

      try {
        const {
          data: authData,
          error: authError
        } =
          await supabase.auth.admin.listUsers({
            page: 1,
            perPage: 1000
          });

        if (authError) {
          console.error(
            "ADMIN AUTH USERS ERROR:",
            authError
          );
        } else {
          authUsers =
            authData?.users || [];
        }
      } catch (error) {
        console.error(
          "ADMIN AUTH USERS EXCEPTION:",
          error
        );
      }

      /* ---------------------------------------------
         MAPS
      --------------------------------------------- */

      const authMap =
        new Map();

      authUsers.forEach(user => {
        authMap.set(
          user.id,
          user
        );
      });

      const accountMap =
        new Map();

      (accounts || []).forEach(
        account => {
          if (
            account.user_id &&
            !accountMap.has(
              account.user_id
            )
          ) {
            accountMap.set(
              account.user_id,
              account
            );
          }
        }
      );

      const balanceMap =
        new Map();

      (balances || []).forEach(
        balance => {
          if (
            balance.account_id
          ) {
            balanceMap.set(
              balance.account_id,
              balance
            );
          }
        }
      );

      /* ---------------------------------------------
         CUSTOMERS ONLY
      --------------------------------------------- */

      const users =
        (profiles || [])
          .filter(
            profile =>
              !isAdminValue(
                profile.is_admin
              )
          )
          .map(profile => {
            const authUser =
              authMap.get(
                profile.id
              );

            const account =
              accountMap.get(
                profile.id
              );

            const accountBalance =
              account
                ? balanceMap.get(
                    account.id
                  )
                : null;

            const firstName =
              profile.first_name ||
              "";

            const surname =
              profile.surname ||
              "";

            const fullName =
              `${firstName} ${surname}`
                .trim() ||
              "Unnamed User";

            const balance =
              Number(
                accountBalance
                  ?.available_balance ??
                  accountBalance
                    ?.balance ??
                  0
              );

            return {
              id:
                profile.id,

              full_name:
                fullName,

              first_name:
                firstName,

              surname:
                surname,

              email:
                authUser?.email ||
                profile.email ||
                "No email",

              phone:
                profile.phone ||
                "",

              balance,

              is_suspended:
                isSuspendedValue(
                  profile.is_suspended
                ),

              account:
                account ||
                null,

              account_balance:
                accountBalance ||
                null
            };
          });

      console.log(
        "ADMIN USERS RETURNED:",
        users.length
      );

      return res.json({
        success: true,
        users
      });
    } catch (error) {
      console.error(
        "ADMIN USERS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load users",
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN SINGLE USER
===================================================== */

app.get(
  "/api/admin/users/:id",
  authenticateAdmin,
  async (req, res) => {
    try {
      const userId =
        req.params.id;

      const {
        data: profile,
        error: profileError
      } =
        await supabase
          .from("profiles")
          .select("*")
          .eq(
            "id",
            userId
          )
          .maybeSingle();

      if (profileError) {
        return res.status(500).json({
          success: false,
          message:
            profileError.message
        });
      }

      if (!profile) {
        return res.status(404).json({
          success: false,
          message:
            "User not found"
        });
      }

      let authUser =
        null;

      try {
        const {
          data,
          error
        } =
          await supabase.auth.admin
            .getUserById(
              userId
            );

        if (!error) {
          authUser =
            data?.user ||
            null;
        }
      } catch (error) {
        console.error(
          "AUTH USER LOOKUP ERROR:",
          error
        );
      }

      const {
        data: address
      } =
        await supabase
          .from("customer_addresses")
          .select("*")
          .eq(
            "user_id",
            userId
          )
          .maybeSingle();

      const {
        data: accounts,
        error: accountsError
      } =
        await supabase
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
          .eq(
            "user_id",
            userId
          );

      if (accountsError) {
        return res.status(500).json({
          success: false,
          message:
            accountsError.message
        });
      }

      let cards = [];

      try {
        const result =
          await supabase
            .from("cards")
            .select("*")
            .eq(
              "user_id",
              userId
            );

        if (!result.error) {
          cards =
            result.data || [];
        }
      } catch (error) {
        console.error(
          "ADMIN CARDS ERROR:",
          error
        );
      }

      const checkingAccount =
        (accounts || []).find(
          account =>
            String(
              account.account_type || ""
            ).toLowerCase() ===
            "checking"
        );

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

      const cardBalance =
        Number(
          cards[0]?.balance ?? 0
        );

      const fullName =
        [
          profile.first_name,
          profile.surname
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

      return res.json({
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

        cards,

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

      return res.status(500).json({
        success: false,
        message:
          "Unable to load user",
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN BALANCE UPDATE
===================================================== */

app.put(
  "/api/admin/users/:id/balances",
  authenticateAdmin,
  async (req, res) => {
    try {
      const userId =
        req.params.id;

      const {
        checking_balance,
        savings_balance,
        card_balance
      } = req.body || {};

      const checking =
        Number(checking_balance);

      const savings =
        Number(savings_balance);

      const card =
        Number(card_balance);

      if (
        !Number.isFinite(checking) ||
        !Number.isFinite(savings) ||
        !Number.isFinite(card)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid balance amount"
        });
      }

      if (
        checking < 0 ||
        savings < 0 ||
        card < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Balance cannot be negative"
        });
      }

      const {
        data: profile,
        error: profileError
      } =
        await supabase
          .from("profiles")
          .select(
            "id, is_admin"
          )
          .eq(
            "id",
            userId
          )
          .maybeSingle();

      if (profileError) {
        return res.status(500).json({
          success: false,
          message:
            profileError.message
        });
      }

      if (!profile) {
        return res.status(404).json({
          success: false,
          message:
            "User not found"
        });
      }

      if (
        isAdminValue(
          profile.is_admin
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Administrator balances cannot be modified here"
        });
      }

      const {
        data: accounts,
        error: accountsError
      } =
        await supabase
          .from("accounts")
          .select("*")
          .eq(
            "user_id",
            userId
          );

      if (accountsError) {
        return res.status(500).json({
          success: false,
          message:
            accountsError.message
        });
      }

      const checkingAccount =
        (accounts || []).find(
          account =>
            String(
              account.account_type || ""
            ).toLowerCase() ===
            "checking"
        );

      let savingsAccount =
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

      if (!checkingAccount) {
        return res.status(400).json({
          success: false,
          message:
            "Checking account not found"
        });
      }

      const {
        error: checkingError
      } =
        await supabase
          .from("account_balances")
          .update({
            available_balance:
              checking,
            ledger_balance:
              checking,
            updated_at:
              new Date().toISOString()
          })
          .eq(
            "account_id",
            checkingAccount.id
          );

      if (checkingError) {
        return res.status(500).json({
          success: false,
          message:
            checkingError.message
        });
      }

      if (savingsAccount) {
        const {
          error: savingsError
        } =
          await supabase
            .from("account_balances")
            .update({
              available_balance:
                savings,
              ledger_balance:
                savings,
              updated_at:
                new Date().toISOString()
            })
            .eq(
              "account_id",
              savingsAccount.id
            );

        if (savingsError) {
          return res.status(500).json({
            success: false,
            message:
              savingsError.message
          });
        }
      } else {
        const accountNumber =
          await generateAccountNumber();

        const {
          data: newSavings,
          error: savingsAccountError
        } =
          await supabase
            .from("accounts")
            .insert({
              user_id:
                userId,
              account_number:
                accountNumber,
              account_type:
                "savings",
              currency:
                "USD",
              status:
                "active"
            })
            .select()
            .single();

        if (
          savingsAccountError ||
          !newSavings
        ) {
          return res.status(500).json({
            success: false,
            message:
              savingsAccountError?.message ||
              "Unable to create savings account"
          });
        }

        savingsAccount =
          newSavings;

        const {
          error: savingsBalanceError
        } =
          await supabase
            .from("account_balances")
            .insert({
              account_id:
                newSavings.id,
              available_balance:
                savings,
              ledger_balance:
                savings
            });

        if (savingsBalanceError) {
          return res.status(500).json({
            success: false,
            message:
              savingsBalanceError.message
          });
        }
      }

      /* ---------------------------------------------
         CARD BALANCE
      --------------------------------------------- */

      try {
        const {
          data: cards
        } =
          await supabase
            .from("cards")
            .select("id")
            .eq(
              "user_id",
              userId
            );

        if (
          cards &&
          cards.length > 0
        ) {
          await supabase
            .from("cards")
            .update({
              balance:
                card
            })
            .eq(
              "user_id",
              userId
            );
        }
      } catch (error) {
        console.error(
          "CARD UPDATE ERROR:",
          error
        );
      }

      return res.json({
        success: true,
        message:
          "User balances updated successfully",
        balances: {
          checking,
          savings,
          card
        }
      });
    } catch (error) {
      console.error(
        "ADMIN BALANCE UPDATE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update user balances",
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN WITHDRAWALS
===================================================== */

app.get(
  "/api/admin/withdrawals",
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("withdrawals")
          .select("*")
          .order("created_at", {
            ascending: false
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        withdrawals:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load withdrawals"
      });
    }
  }
);

/* =====================================================
   ADMIN APPROVE WITHDRAWAL
===================================================== */

app.patch(
  "/api/admin/withdrawals/:id/approve",
  authenticateAdmin,
  async (req, res) => {
    try {
      const withdrawalId =
        req.params.id;

      const {
        data: withdrawal,
        error: lookupError
      } =
        await supabase
          .from("withdrawals")
          .select("*")
          .eq(
            "id",
            withdrawalId
          )
          .maybeSingle();

      if (lookupError) {
        return res.status(500).json({
          success: false,
          message:
            lookupError.message
        });
      }

      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          message:
            "Withdrawal not found"
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Withdrawal is no longer pending"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("withdrawals")
          .update({
            status:
              "approved",
            reviewed_by:
              req.user.id,
            reviewed_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            withdrawalId
          )
          .eq(
            "status",
            "pending"
          )
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      try {
        await supabase
          .from("notifications")
          .insert({
            user_id:
              withdrawal.user_id,
            title:
              "Withdrawal Approved",
            message:
              `Your withdrawal request for ${withdrawal.amount} ${withdrawal.currency} has been approved.`,
            type:
              "transaction"
          });
      } catch (error) {
        console.error(
          "WITHDRAWAL NOTIFICATION ERROR:",
          error
        );
      }

      try {
        await supabase
          .from("audit_logs")
          .insert({
            admin_id:
              req.user.id,
            action:
              "approve_withdrawal",
            target_type:
              "withdrawal",
            target_id:
              withdrawal.id,
            description:
              `Approved withdrawal ${withdrawal.id}`
          });
      } catch (error) {
        console.error(
          "AUDIT LOG ERROR:",
          error
        );
      }

      return res.json({
        success: true,
        message:
          "Withdrawal approved",
        withdrawal:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to approve withdrawal"
      });
    }
  }
);

/* =====================================================
   ADMIN REJECT WITHDRAWAL
===================================================== */

app.patch(
  "/api/admin/withdrawals/:id/reject",
  authenticateAdmin,
  async (req, res) => {
    try {
      const withdrawalId =
        req.params.id;

      const {
        data: withdrawal,
        error: lookupError
      } =
        await supabase
          .from("withdrawals")
          .select("*")
          .eq(
            "id",
            withdrawalId
          )
          .maybeSingle();

      if (lookupError) {
        return res.status(500).json({
          success: false,
          message:
            lookupError.message
        });
      }

      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          message:
            "Withdrawal not found"
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Withdrawal is no longer pending"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("withdrawals")
          .update({
            status:
              "rejected",
            reviewed_by:
              req.user.id,
            reviewed_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            withdrawalId
          )
          .eq(
            "status",
            "pending"
          )
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      try {
        await supabase
          .from("notifications")
          .insert({
            user_id:
              withdrawal.user_id,
            title:
              "Withdrawal Rejected",
            message:
              `Your withdrawal request for ${withdrawal.amount} ${withdrawal.currency} was rejected.`,
            type:
              "transaction"
          });
      } catch (error) {
        console.error(
          "WITHDRAWAL NOTIFICATION ERROR:",
          error
        );
      }

      try {
        await supabase
          .from("audit_logs")
          .insert({
            admin_id:
              req.user.id,
            action:
              "reject_withdrawal",
            target_type:
              "withdrawal",
            target_id:
              withdrawal.id,
            description:
              `Rejected withdrawal ${withdrawal.id}`
          });
      } catch (error) {
        console.error(
          "AUDIT LOG ERROR:",
          error
        );
      }

      return res.json({
        success: true,
        message:
          "Withdrawal rejected",
        withdrawal:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to reject withdrawal"
      });
    }
  }
);

/* =====================================================
   ADMIN SUPPORT
===================================================== */

app.get(
  "/api/admin/support/conversations",
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("support_conversations")
          .select("*")
          .order("updated_at", {
            ascending: false
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        conversations:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load support conversations"
      });
    }
  }
);

app.get(
  "/api/admin/support/conversations/:id/messages",
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("support_messages")
          .select("*")
          .eq(
            "conversation_id",
            req.params.id
          )
          .order("created_at", {
            ascending: true
          });

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        messages:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load messages"
      });
    }
  }
);

app.post(
  "/api/admin/support/conversations/:id/messages",
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        message
      } = req.body || {};

      if (!message) {
        return res.status(400).json({
          success: false,
          message:
            "Message is required"
        });
      }

      const {
        data: conversation
      } =
        await supabase
          .from("support_conversations")
          .select("*")
          .eq(
            "id",
            req.params.id
          )
          .maybeSingle();

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message:
            "Conversation not found"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("support_messages")
          .insert({
            conversation_id:
              req.params.id,
            sender_type:
              "admin",
            sender_id:
              req.user.id,
            message:
              String(message).trim()
          })
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      await supabase
        .from("support_conversations")
        .update({
          updated_at:
            new Date().toISOString(),
          status:
            "open"
        })
        .eq(
          "id",
          req.params.id
        );

      try {
        await supabase
          .from("notifications")
          .insert({
            user_id:
              conversation.user_id,
            title:
              "New Support Message",
            message:
              "You have received a new message from Sterling One Bank Support.",
            type:
              "system"
          });
      } catch (error) {
        console.error(
          "SUPPORT NOTIFICATION ERROR:",
          error
        );
      }

      return res.status(201).json({
        success: true,
        message:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to send support message"
      });
    }
  }
);

app.patch(
  "/api/admin/support/conversations/:id/close",
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("support_conversations")
          .update({
            status:
              "closed",
            updated_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            req.params.id
          )
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        message:
          "Conversation closed",
        conversation:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to close conversation"
      });
    }
  }
);

/* =====================================================
   404 HANDLER
===================================================== */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message:
      `Route not found: ${req.method} ${req.originalUrl}`
  });
});

/* =====================================================
   GLOBAL ERROR HANDLER
===================================================== */

app.use((error, req, res, next) => {
  console.error(
    "UNHANDLED SERVER ERROR:",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    message:
      "Internal server error",
    error:
      error.message
  });
});

/* =====================================================
   START SERVER
===================================================== */

app.listen(
  PORT,
  () => {
    console.log(
      `Sterling One Bank API running on port ${PORT}`
    );
  }
);