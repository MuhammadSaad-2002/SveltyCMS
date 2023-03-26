import nodemailer from 'nodemailer';

import { SMTP_HOST, SMTP_PORT, SMTP_PASSWORD, SMTP_EMAIL } from '$env/static/private';
import { render } from 'svelte-email';
import WelcomeUser from '$lib/emails/welcomeUser.svelte';

/** Send email
 * @param {string} email - user email address
 *
 * @param {string} subject - Email subject
 * @param {string} message - Email message
 *
 * Optional args: html - send html message to client
 * Suggest: Move secure to true (probably will need in future)
 */

async function sendMail(email: string, subject: string, message: string, html?: string) {
	const transporter = nodemailer.createTransport({
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore

		host: SMTP_HOST,
		port: 465,
		secure: true,
		// port: SMTP_PORT,
		// secure: false, // true for 465, false for other ports
		auth: {
			user: SMTP_EMAIL, // generated ethereal user
			pass: SMTP_PASSWORD // generated ethereal password
		}
	});
	// const emailOptions = {
	// 	from: SMTP_EMAIL,
	// 	to: email, // list of receivers
	// 	subject: subject, // Subject line
	// 	text: message, // plain text body
	// 	html: 'html' // optionally include an HTML message
	// };
	const emailHtml = render({
		template: WelcomeUser,
		props: {
			name: 'Svelte'
		}
	});

	const options = {
		from: SMTP_EMAIL,
		to: email,
		subject: subject,
		html: emailHtml
	};

	const info = transporter.sendMail(options, (error, info) => {
		if (error) {
			return console.log(error);
		}
		console.log('Message sent: %s', info.messageId);
		console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
	});

	//const info = await transporter.sendMail(emailOptions);
	return info;
}

export default sendMail;