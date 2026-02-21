const signupForm = document.getElementById("signup-form");
const signupFeedback = document.getElementById("signup-feedback");
const signupButton = signupForm?.querySelector(".signup-btn");

const setSignupFeedback = (message, type = "error") => {
  if (!signupFeedback) return;
  signupFeedback.textContent = message || "";
  signupFeedback.classList.remove("is-error", "is-success");
  if (message) {
    signupFeedback.classList.add(type === "success" ? "is-success" : "is-error");
  }
};

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setSignupFeedback("");

    const fullName = document.getElementById("full-name")?.value?.trim() || "";
    const username = document.getElementById("username")?.value?.trim() || "";
    const email = document.getElementById("email")?.value?.trim() || "";
    const password = document.getElementById("password")?.value || "";
    const confirmPassword = document.getElementById("confirm-password")?.value || "";
    const termsAccepted = Boolean(document.getElementById("terms")?.checked);

    if (!fullName || !username || !email || !password || !confirmPassword) {
      setSignupFeedback("Please fill in all required fields.");
      return;
    }

    if (!termsAccepted) {
      setSignupFeedback("Please accept the terms to continue.");
      return;
    }

    if (password !== confirmPassword) {
      setSignupFeedback("Passwords do not match.");
      return;
    }

    if (signupButton) {
      signupButton.disabled = true;
      signupButton.textContent = "Creating account...";
    }

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, username, email, password, confirmPassword }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setSignupFeedback(payload?.error || "Signup failed.");
        return;
      }

      setSignupFeedback("Account created. Redirecting to login...", "success");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 800);
    } catch (error) {
      setSignupFeedback("Unable to reach server. Please try again.");
    } finally {
      if (signupButton) {
        signupButton.disabled = false;
        signupButton.textContent = "Create Account";
      }
    }
  });
}
