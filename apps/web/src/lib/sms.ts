// Swappable SMS/OTP sender (decision deferred — mock now).
export interface SmsAdapter {
  send(phone: string, message: string): Promise<void>;
}

class MockSms implements SmsAdapter {
  async send(phone: string, message: string): Promise<void> {
    console.log(`[mock-sms] -> ${phone}: ${message}`);
  }
}

export function getSms(): SmsAdapter {
  switch (process.env.SMS_PROVIDER ?? "mock") {
    case "mock":
    default:
      return new MockSms();
  }
}

export function genOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
