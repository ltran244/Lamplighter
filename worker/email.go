package worker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	mail "github.com/wneessen/go-mail"
)

func sendMonitorAlerts(ctx context.Context, targets []string, monitor *Monitor, result CheckResult, alert string) error {
	username := os.Getenv("EMAIL")
	password := os.Getenv("EMAIL_PASSWORD")
	if username == "" || password == "" {
		return fmt.Errorf("EMAIL and EMAIL_PASSWORD must be set to send alerts")
	}

	client, err := mail.NewClient("smtp.ethereal.email",
		mail.WithPort(587),
		mail.WithSMTPAuth(mail.SMTPAuthPlain),
		mail.WithUsername(username),
		mail.WithPassword(password),
		mail.WithTLSPolicy(mail.TLSMandatory),
		mail.WithTimeout(10*time.Second),
	)
	if err != nil {
		return err
	}

	subject := fmt.Sprintf("Lamplighter: %s is %s", monitor.Name, alert)
	body := fmt.Sprintf("Monitor: %s\nURL: %s\nStatus: %s\nTime: %s\n",
		monitor.Name, monitor.URL, alert, result.FinishedAt.UTC().Format(time.RFC3339))
	if alert == "down" {
		body += "Reason: " + result.Error + "\n"
	}

	var sendErrors error
	for _, target := range targets {
		if ctx.Err() != nil {
			return errors.Join(sendErrors, ctx.Err())
		}

		message := mail.NewMsg()
		if err := message.From(username); err != nil {
			return err
		}
		if err := message.To(target); err != nil {
			sendErrors = errors.Join(sendErrors, err)
			continue
		}
		message.Subject(subject)
		message.SetBodyString(mail.TypeTextPlain, body)

		sendCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := client.DialAndSendWithContext(sendCtx, message)
		cancel()
		if err != nil {
			sendErrors = errors.Join(sendErrors, err)
		}
	}
	return sendErrors
}
