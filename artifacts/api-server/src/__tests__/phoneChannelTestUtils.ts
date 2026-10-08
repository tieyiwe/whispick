import { beforeAll, afterAll } from "vitest";

// SMS/WhatsApp delivery ships OFF by default (lib/messagingChannels.ts), and
// the routes reject phone-channel sends outright while off. Test files that
// exercise the phone-channel paths themselves (consent gates, matching,
// Text Whisps…) opt back in for the whole file with this, restoring whatever
// was there before afterwards so a flag never leaks into another file.
// messagingChannels.test.ts covers the default-off behavior on its own.
export function enablePhoneChannelsForFile(): void {
  let prevSms: string | undefined;
  let prevWhatsApp: string | undefined;

  beforeAll(() => {
    prevSms = process.env.SMS_DELIVERY_ENABLED;
    prevWhatsApp = process.env.WHATSAPP_DELIVERY_ENABLED;
    process.env.SMS_DELIVERY_ENABLED = "true";
    process.env.WHATSAPP_DELIVERY_ENABLED = "true";
  });

  afterAll(() => {
    restoreEnv("SMS_DELIVERY_ENABLED", prevSms);
    restoreEnv("WHATSAPP_DELIVERY_ENABLED", prevWhatsApp);
  });
}

export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
