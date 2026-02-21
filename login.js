const loginForm = document.getElementById("login-form");
const loginFeedback = document.getElementById("login-feedback");
const loginButton = loginForm?.querySelector(".login-btn");

const setFeedback = (message, type = "error") => {
  if (!loginFeedback) return;
  loginFeedback.textContent = message || "";
  loginFeedback.classList.remove("is-error", "is-success");
  if (message) {
    loginFeedback.classList.add(type === "success" ? "is-success" : "is-error");
  }
};

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback("");

    const username = document.getElementById("username")?.value?.trim() || "";
    const password = document.getElementById("password")?.value || "";

    if (!username || !password) {
      setFeedback("Please enter your username and password.");
      return;
    }

    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent = "Signing in...";
    }

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setFeedback(payload?.error || "Login failed.");
        return;
      }

      if (payload?.user) {
        localStorage.setItem("llmCouncilUser", JSON.stringify(payload.user));
      }

      setFeedback("Login successful. Redirecting...", "success");
      setTimeout(() => {
        window.location.href = "index.html";
      }, 600);
    } catch (error) {
      setFeedback("Unable to reach server. Please try again.");
    } finally {
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Sign In";
      }
    }
  });
}
