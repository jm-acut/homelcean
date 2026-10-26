function showMessage(element, message, type = "") {
  if (!element) return;
  element.textContent = message;
  element.className = "message" + (type ? " " + type : "");
  element.hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  const signupForm = document.querySelector("#signup-form");
  const signinForm = document.querySelector("#signin-form");
  const forgotForm = document.querySelector("#forgot-form");
  const updateForm = document.querySelector("#update-form");

  const message = document.querySelector("#message");

  if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = signupForm.querySelector("button[type=submit]");
      button.disabled = true;

      try {
        const email = signupForm.email.value.trim();
        const password = signupForm.password.value;
        const confirmPassword = signupForm.confirmPassword.value;

        if (password.length < 8) {
          throw new Error("Use a password with at least 8 characters.");
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/signin.html"
          }
        });

        if (error) throw error;

        if (data.session) {
          showMessage(
            message,
            "Account created. You can now sign in.",
            "success"
          );
        } else {
          showMessage(
            message,
            "Registration submitted. Check your email for confirmation before signing in.",
            "success"
          );
        }

        signupForm.reset();
      } catch (error) {
        showMessage(message, error.message || "Registration failed.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  if (signinForm) {
    signinForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = signinForm.querySelector("button[type=submit]");
      button.disabled = true;

      try {
        const { error } = await supabaseClient.auth.signInWithPassword({
          email: signinForm.email.value.trim(),
          password: signinForm.password.value
        });

        if (error) throw error;

        window.location.href = "index.html";
      } catch (error) {
        showMessage(message, error.message || "Sign-in failed.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  if (forgotForm) {
    forgotForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = forgotForm.querySelector("button[type=submit]");
      button.disabled = true;

      try {
        const { error } =
          await supabaseClient.auth.resetPasswordForEmail(
            forgotForm.email.value.trim(),
            {
              redirectTo:
                window.location.origin + "/update-password.html"
            }
          );

        if (error) throw error;

        showMessage(
          message,
          "If the address is registered, recovery instructions may arrive by email.",
          "success"
        );
      } catch (error) {
        showMessage(message, error.message || "Recovery request failed.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  if (updateForm) {
    updateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = updateForm.querySelector("button[type=submit]");
      button.disabled = true;

      try {
        const password = updateForm.password.value;
        const confirmPassword = updateForm.confirmPassword.value;

        if (password.length < 8) {
          throw new Error("Use a password with at least 8 characters.");
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const { data } = await supabaseClient.auth.getSession();

        if (!data.session) {
          throw new Error(
            "Your recovery session is missing or expired. Request a new recovery email."
          );
        }

        const { error } = await supabaseClient.auth.updateUser({
          password
        });

        if (error) throw error;

        showMessage(
          message,
          "Password updated. You can now sign in with your new password.",
          "success"
        );

        updateForm.reset();
      } catch (error) {
        showMessage(message, error.message || "Password update failed.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }
});