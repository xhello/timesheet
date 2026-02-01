import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { to, businessName, businessCode } = await request.json();

    const { data, error } = await resend.emails.send({
      from: 'TimeSheet <onboarding@justicehire.com>',
      to: [to],
      subject: 'Welcome to TimeSheet - Your Business ID',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to TimeSheet</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
            <div style="background-color: white; border-radius: 12px; padding: 40px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #4F46E5; margin: 0;">⏰ TimeSheet</h1>
                    <p style="color: #666; margin-top: 5px;">Face Verification Time Tracking</p>
                </div>
                
                <h2 style="color: #333; margin-bottom: 20px;">Welcome, ${businessName}!</h2>
                
                <p style="color: #555; line-height: 1.6;">
                    Your business has been successfully registered. Use the Business ID below to log in to TimeSheet.
                </p>
                
                <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0;">
                    <p style="color: rgba(255,255,255,0.8); margin: 0 0 10px 0; font-size: 14px;">Your Business ID</p>
                    <h1 style="color: white; margin: 0; font-size: 36px; letter-spacing: 8px; font-family: monospace;">${businessCode}</h1>
                </div>
                
                <div style="background-color: #FEF3C7; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                    <p style="color: #92400E; margin: 0; font-size: 14px;">
                        <strong>⚠️ Important:</strong> Keep this Business ID safe! You'll need it every time you open the app. Share it only with employees who need to clock in/out.
                    </p>
                </div>
                
                <h3 style="color: #333; margin-top: 30px;">Getting Started:</h3>
                <ol style="color: #555; line-height: 1.8;">
                    <li>Go to TimeSheet web app</li>
                    <li>Enter your Business ID: <strong>${businessCode}</strong></li>
                    <li>Click "Login"</li>
                    <li>Register employees using face verification</li>
                    <li>Employees can now clock in/out using their face!</li>
                </ol>
                
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    This email was sent by TimeSheet. If you didn't register a business, please ignore this email.
                </p>
            </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error('Email error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Send email error:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
