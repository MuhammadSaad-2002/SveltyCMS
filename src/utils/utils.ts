import fs from 'fs';
import axios from 'axios';
import Path from 'path';
import mongoose from 'mongoose';

import { publicEnv } from '@root/config/public';
import type { Schema } from '@collections/types';
import { browser } from '$app/environment';
import _crypto from 'crypto';
import type { z } from 'zod';

// Stores
import { get } from 'svelte/store';
import { translationProgress, contentLanguage, entryData, mode, collections, collection } from '@stores/store';

// Auth
import { UserSchema } from '@src/auth/types';

export const config = {
	headers: {
		'Content-Type': 'multipart/form-data'
	}
};

// This function generates GUI fields based on field parameters and a GUI schema.
export const getGuiFields = (fieldParams: { [key: string]: any }, GuiSchema: { [key: string]: any }) => {
	const guiFields = {};
	for (const key in GuiSchema) {
		if (Array.isArray(fieldParams[key])) {
			guiFields[key] = deepCopy(fieldParams[key]);
		} else {
			guiFields[key] = fieldParams[key];
		}
	}
	return guiFields;
};

// Function to convert an object to form data
export const obj2formData = (obj: any) => {
	// console.log(obj);
	// Create a new FormData object
	const formData = new FormData();
	// Iterate over the keys of the input object
	for (const key in obj) {
		// Append each key-value pair to the FormData object as a string
		const data = JSON.stringify(obj[key], (key, val) => {
			if (!val && val !== false) return undefined;
			else if (key == 'schema') return undefined;
			else if (key == 'display' && val.default == true) return undefined;
			else if (key == 'display') return ('🗑️' + val + '🗑️').replaceAll('display', 'function display');
			else if (key == 'widget') return { key: val.key, GuiFields: val.GuiFields };
			else if (typeof val === 'function') {
				return '🗑️' + val + '🗑️';
			}
			return val;
		});
		if (!data) continue;
		formData.append(key, data);
	}
	// Return the FormData object
	return formData;
};

// Converts data to FormData object
export const col2formData = async (getData: { [Key: string]: () => any }) => {
	// used to save data
	const formData = new FormData();
	const data = {};
	const parseFiles = (object: any) => {
		for (const key in object) {
			if (!(object[key] instanceof File) && typeof object[key] == 'object') {
				parseFiles(object[key]);
				continue;
			} else if (!(object[key] instanceof File)) {
				continue;
			}
			// object[key] is file here
			const uuid = crypto.randomUUID();
			formData.append(uuid, object[key]);
			object[key] = { instanceof: 'File', id: uuid, path: object[key].path };
		}
	};

	for (const key in getData) {
		const value = await getData[key]();
		if (!value) continue;
		data[key] = value;
	}

	parseFiles(data);

	for (const key in data) {
		if (typeof data[key] === 'object') {
			formData.append(key, JSON.stringify(data[key]));
		} else {
			formData.append(key, data[key]);
		}
	}
	if (!formData.entries().next().value) {
		return null;
	}
	return formData;
};

// Helper function to sanitize file names
export function sanitize(str: string) {
	return str.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
}

// Get the environment variables for image sizes
const env_sizes = publicEnv.IMAGE_SIZES;
export const SIZES = { ...env_sizes, original: 0, thumbnail: 200 } as const;
// Saves image to disk and returns file information
export async function saveImages(data: { [key: string]: any }, collectionName: string) {
	if (browser) return;
	const sharp = (await import('sharp')).default;
	const fields: { file: any; replace: (id: string) => void }[] = [];
	const parseFiles = async (data: any) => {
		for (const fieldname in data) {
			if (!(data[fieldname] instanceof File) && typeof data[fieldname] == 'object') {
				await parseFiles(data[fieldname]);
				continue;
			} else if (!(data[fieldname] instanceof File)) {
				continue;
			}

			const blob = data[fieldname] as any;
			const arrayBuffer = await blob.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const hash = _crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
			const existing_file = await mongoose.models['image_files'].findOne({ hash: hash });
			if (existing_file) {
				data[fieldname] = existing_file;
				continue;
			}
			const path = blob.path;
			const { name, ext } = removeExtension(blob.name);

			// Original image

			let url: any;
			if (path == 'global') {
				url = `images/original/${hash}.${ext}`;
			} else if (path == 'unique') {
				url = `images/${collectionName}/original/${hash}.${ext}`;
			} else {
				url = `images/${path}/original/${hash}.${ext}`;
			}
			const info = await sharp(buffer).metadata();
			data[fieldname] = {
				hash,
				original: {
					name: `${hash}-${blob.name}`,
					hash: hash,
					url,
					size: blob.size,
					type: blob.type,
					width: info.width,
					height: info.height,
					createdAt: new Date(),
					lastModified: blob.lastModified as Date
				}
			};

			if (!fs.existsSync(Path.dirname(`${publicEnv.MEDIA_FOLDER}/${url}`))) {
				fs.mkdirSync(Path.dirname(`${publicEnv.MEDIA_FOLDER}/${url}`), { recursive: true });
			}

			fs.writeFileSync(`${publicEnv.MEDIA_FOLDER}/${url}`, buffer);
			for (const size in SIZES) {
				if (size == 'original') continue;
				const fullName = `${hash}-${name}.${publicEnv.MEDIA_OUTPUT_FORMAT_QUALITY.format}`;
				const resizedImage = await sharp(buffer)
					.rotate() // Rotate image according to EXIF data
					.resize({ width: SIZES[size] })
					.toFormat(publicEnv.MEDIA_OUTPUT_FORMAT_QUALITY.format as keyof import('sharp').FormatEnum, {
						quality: publicEnv.MEDIA_OUTPUT_FORMAT_QUALITY.quality
					})
					.toBuffer({ resolveWithObject: true });
				let url;

				if (path == 'global') {
					url = `images/${size}/${fullName}`;
				} else if (path == 'unique') {
					url = `images/${collectionName}/${size}/${fullName}`;
				} else {
					url = `images/${path}/${size}/${fullName}`;
				}
				if (!fs.existsSync(Path.dirname(`${publicEnv.MEDIA_FOLDER}/${url}`))) {
					fs.mkdirSync(Path.dirname(`${publicEnv.MEDIA_FOLDER}/${url}`), { recursive: true });
				}
				//sized images
				fs.writeFileSync(`${publicEnv.MEDIA_FOLDER}/${url}`, resizedImage.data);
				data[fieldname][size] = {
					name: `${name}.${publicEnv.MEDIA_OUTPUT_FORMAT_QUALITY.format}`,
					hash: hash,
					url: '/media/' + url,
					type: `image/${publicEnv.MEDIA_OUTPUT_FORMAT_QUALITY.format}`,
					size: resizedImage.info.size,
					width: resizedImage.info.width,
					height: resizedImage.info.height,
					createdAt: new Date(),
					lastModified: blob.lastModified as Date
				};
			}
			fields.push({
				file: data[fieldname],
				replace: (id) => {
					data[fieldname] = id;
				}
			});
		}
	};

	await parseFiles(data);
	const res = await mongoose.models['media_images'].insertMany(fields.map((v) => v.file));
	for (const index in res) {
		const id = res[index]._id;
		fields[index].replace(id);
	}
}

// finds field title that matches the fieldname and returns that field
function _findFieldByTitle(schema: any, fieldname: string, found = { val: false }): any {
	for (const field of schema.fields) {
		// console.log('field is ', field.db_fieldName, field.label);
		if (field.db_fieldName == fieldname || field.label == fieldname) {
			found.val = true;

			return field;
		} else if (field.fields && field.fields.length > 0) {
			return _findFieldByTitle(field, fieldname, found);
		}
	}
	if (!found) {
		throw new Error('FIELD NOT FOUND');
	}
}

// takes an object and recursively parses any values that can be converted to JSON
export function parse(obj: any) {
	for (const key in obj) {
		try {
			if (Array.isArray(obj[key])) {
				for (const index of obj[key]) {
					obj[key][index] = JSON.parse(obj[key][index]);
				}
			} else {
				obj[key] = JSON.parse(obj[key]);
			}
		} catch (e) {
			console.error(e);
		}

		if (typeof obj[key] != 'string') {
			parse(obj[key]);
		}
	}
	return obj;
}

// Converts fields to schema object
export const fieldsToSchema = (fields: Array<any>) => {
	// removes widget, so it does not set up in db
	let schema: any = {};
	for (const field of fields) {
		schema = { ...schema, ...field.schema };
	}
	delete schema.widget;
	return schema;
};

// Finds documents in collection that match query
export async function find(query: object, collectionName: string) {
	if (!collectionName) return;
	const _query = JSON.stringify(query);
	return (await axios.get(`/api/find?collection=${collectionName}&query=${_query}`)).data;
}

// Finds document in collection with specified ID
export async function findById(id: string, collectionName: string) {
	if (!id || !collectionName) return;
	return (await axios.get(`/api/find?collection=${collectionName}&id=${id}`)).data;
}

// Returns field's database field name or label
export function getFieldName(field: any, sanitize = false) {
	if (sanitize) {
		return (field?.db_fieldName || field?.label)?.replaceAll(' ', '_');
	}
	return (field?.db_fieldName || field?.label) as string;
}

//Save Collections data to database

export async function saveFormData({ data, _collection, _mode, id }: { data: any; _collection?: Schema; _mode?: 'edit' | 'create'; id?: string }) {
	console.log('saveFormData was called');
	const $mode = _mode || get(mode);
	const $collection = _collection || get(collection);
	const $entryData = get(entryData);
	const formData = data instanceof FormData ? data : await col2formData(data);
	if (_mode === 'edit' && !id) {
		throw new Error('ID is required for edit mode.');
	}
	if (!formData) return;

	// Define status for each collection
	formData.append('status', $collection.status || 'unpublished');

	switch ($mode) {
		// Create a new Collection
		case 'create':
			return await axios.post(`/api/${$collection.name}`, formData, config).then((res) => res.data);
		// Edit an existing Collection
		case 'edit':
			formData.append('_id', id || $entryData._id);
			formData.append('updatedAt', new Date().getTime().toString());

			if ($collection.revision) {
				// Create a new revision of the Collection
				const newRevision = {
					...$entryData,
					_id: new mongoose.Types.ObjectId().toString, // Generate a new ObjectId for the new revision
					__v: [
						{
							revisionNumber: $entryData.__v.length, // Start the revision number at the current length of the __v array
							editedAt: new Date().getTime().toString(),
							editedBy: { Username: UserSchema.username },
							changes: {}
						}
					]
				};

				// Append the new revision to the existing revisions
				const revisions = $entryData.__v || [];
				revisions.push(newRevision);

				// Update the __v array with the new revisions
				$entryData.__v = revisions;

				// Save the new revision to the database
				await axios.post(`/api/${$collection.name}`, newRevision, config).then((res) => res.data);
			}

			return await axios.patch(`/api/${$collection.name}`, formData, config).then((res) => res.data);
	}
}

// Function to delete image files associated with a content item
export async function deleteImageFiles(collectionName: string, fileName: string) {
	const env_sizes = publicEnv.IMAGE_SIZES;
	const SIZES = { ...env_sizes, original: 0, thumbnail: 200 } as const;

	const collection = get(collections).find((collection) => collection.name === collectionName);

	const path = _findFieldByTitle(collection, 'yourFieldName').path; // Replace 'yourFieldName' with the actual field name storing the image file

	try {
		// Delete the original image file
		fs.unlinkSync(`${publicEnv.MEDIA_FOLDER}/${path}/${collectionName}/original/${fileName}`);

		// Delete resized image files
		for (const size in SIZES) {
			fs.unlinkSync(`${publicEnv.MEDIA_FOLDER}/${path}/${collectionName}/${size}/${fileName}`);
		}

		// console.log(`Deleted image files associated with ${fileName}`);
	} catch (error) {
		console.error(`Error deleting image files: ${error}`);
		// Handle the error as needed
	}
}

// Move FormData to trash folder and delete trash files older than 30 days
export async function deleteData(id: any, collectionName: any) {
	// Fetch the entry data before deleting
	const entryData = await findById(id, collectionName);

	// Check if the collection has an 'images' field
	if (entryData && entryData.images) {
		// Move image files associated with the entry to trash folder
		for (const fieldName in entryData.images) {
			const fileName = entryData.images[fieldName]?.original?.name;
			if (fileName) {
				await moveImageFilesToTrash(collectionName, fileName);
			}
		}
	}

	// Move the content item to trash folder
	await fetch(`/api/trash/${collectionName}/${id}`, { method: 'PUT' });

	// Delete trash files older than 30 days
	await deleteOldTrashFiles();
}

// Move image files to trash folder
async function moveImageFilesToTrash(collectionName: string, fileName: string) {
	const env_sizes = publicEnv.IMAGE_SIZES;
	const SIZES = { ...env_sizes, original: 0, thumbnail: 200 } as const;

	const collection = get(collections).find((collection) => collection.name === collectionName);

	const path = _findFieldByTitle(collection, 'yourFieldName').path; // Replace 'yourFieldName' with the actual field name storing the image file

	try {
		// Move the original image file to trash folder
		fs.renameSync(
			`${publicEnv.MEDIA_FOLDER}/${path}/${collectionName}/original/${fileName}`,
			`${publicEnv.MEDIA_FOLDER}/trash/${path}/${collectionName}/original/${fileName}`
		);

		// Move resized image files to trash folder
		for (const size in SIZES) {
			fs.renameSync(
				`${publicEnv.MEDIA_FOLDER}/${path}/${collectionName}/${size}/${fileName}`,
				`${publicEnv.MEDIA_FOLDER}/trash/${path}/${collectionName}/${size}/${fileName}`
			);
		}

		console.log(`Moved image files associated with ${fileName} to trash folder`);
	} catch (error) {
		console.error(`Error moving image files to trash folder: ${error}`);
		// Handle the error as needed
	}
}

// Delete trash files older than 30 days
async function deleteOldTrashFiles() {
	// Get the current date
	const current_date = new Date();

	// Calculate the timestamp for 30 days ago
	const thirty_days_ago = new Date(current_date.getTime() - 30 * 24 * 60 * 60 * 1000);

	// Find all trash files that were created before the 30-day mark
	const old_trash_files = fs.readdirSync('/path/to/trash').filter((file) => {
		const stats = fs.statSync(`/path/to/trash/${file}`);
		return stats.ctime < thirty_days_ago;
	});

	// Delete the old trash files
	old_trash_files.forEach((file) => {
		fs.unlinkSync(`/path/to/trash/${file}`);
	});
}

export async function extractData(fieldsData: any): Promise<{ [key: string]: any }> {
	// extracts data from fieldsData because FieldsData is async
	const temp = {};
	for (const key in fieldsData) {
		temp[key] = await fieldsData[key]();
	}
	return temp;
}

/**
 * Formats a file size in bytes to the appropriate unit (bytes, kilobytes, megabytes, or gigabytes).
 * @param sizeInBytes - The size of the file in bytes.
 * @returns The formatted file size as a string.
 */
export function formatBytes(bytes: number) {
	if (bytes < 0) {
		throw new Error('Input size cannot be negative');
	}

	const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
	let power = 0;

	while (bytes >= 1024 && power < units.length - 1) {
		bytes /= 1024;
		power++;
	}

	return `${bytes.toFixed(2)} ${units[power]}`;
}

// Function to convert Unix timestamp to readable date string
export function convertTimestampToDateString(timestamp: number) {
	if (timestamp === null || timestamp === undefined) {
		return '-';
	}

	const options: Intl.DateTimeFormatOptions = {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	};
	const locale = get(contentLanguage);
	const date = new Date(timestamp);
	return date.toLocaleDateString(locale, options);
}

export function formatUptime(uptime: number) {
	const units = [
		{ label: ['year', 'years'], value: 365 * 24 * 60 * 60 },
		{ label: ['month', 'months'], value: 30 * 24 * 60 * 60 },
		{ label: ['week', 'weeks'], value: 7 * 24 * 60 * 60 },
		{ label: ['day', 'days'], value: 24 * 60 * 60 },
		{ label: ['hour', 'hours'], value: 60 * 60 },
		{ label: ['minute', 'minutes'], value: 60 },
		{ label: ['second', 'seconds'], value: 1 }
	];

	const result: string[] = [];
	for (const unit of units) {
		const quotient = Math.floor(uptime / unit.value);
		if (quotient > 0) {
			result.push(`${quotient} ${unit.label[quotient > 1 ? 1 : 0]}`);
			uptime %= unit.value;
		}
	}

	return result.join(' ');
}

// Export function for ReadableExpireIn
export function ReadableExpireIn(expiresIn: string) {
	const expiresInNumber = parseInt(expiresIn, 10); // Assuming expiresIn is a string representation of a number
	const expirationTime = expiresInNumber ? new Date(Date.now() + expiresInNumber) : new Date(); // Calculate expiration time

	const daysDiff = Math.floor((expirationTime.getTime() - Date.now()) / (1000 * 60 * 60 * 24)); // Convert milliseconds to days
	const hoursDiff = Math.floor((expirationTime.getTime() - Date.now()) / (1000 * 60 * 60)) % 24; // Convert remaining milliseconds to hours
	const minutesDiff = Math.floor((expirationTime.getTime() - Date.now()) / (1000 * 60)) % 60; // Convert remaining milliseconds to minutes

	const daysText = daysDiff > 0 ? `${daysDiff} day${daysDiff > 1 ? 's' : ''}` : '';
	const hoursText = hoursDiff > 0 ? `${hoursDiff} hour${hoursDiff > 1 ? 's' : ''}` : '';
	const minutesText = minutesDiff > 0 ? `${minutesDiff} minute${minutesDiff > 1 ? 's' : ''}` : '';

	return `${daysText} ${hoursText} ${minutesText}`.trim();
}

function removeExtension(fileName: any) {
	const lastDotIndex = fileName.lastIndexOf('.');
	if (lastDotIndex === -1) {
		// If the file has no extension, return the original fileName
		return { name: fileName, ext: '' };
	}
	return { name: fileName.slice(0, lastDotIndex), ext: fileName.slice(lastDotIndex + 1) };
}

export const asAny = (value: any) => value;

// This function takes an object as a parameter and returns a deep copy of it
function deepCopy(obj: any) {
	// If the object is not an object or is null, return it as it is
	if (typeof obj !== 'object' || obj === null) {
		return obj;
	}

	// If the object is a Date instance, return a new Date with the same time value
	if (obj instanceof Date) {
		return new Date(obj.getTime());
	}

	// If the object is an Array instance, return a new array with deep copies of each element
	if (obj instanceof Array) {
		return obj.reduce((arr, item, i) => {
			// Recursively call deepCopy on each element and assign it to the new array
			arr[i] = deepCopy(item);
			return arr;
		}, []);
	}

	// If the object is a plain object, return a new object with deep copies of each property
	if (obj instanceof Object) {
		return Object.keys(obj).reduce((newObj, key) => {
			// Recursively call deepCopy on each property value and assign it to the new object
			newObj[key] = deepCopy(obj[key]);
			return newObj;
		}, {});
	}
}

export function debounce(delay?: number) {
	let timer: any;
	let first = true;
	return (fn: () => void) => {
		if (first) {
			fn();
			first = false;
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(() => {
			fn();
		}, delay);
	};
}

export function validateZod<T>(schema: z.Schema<T>, value?: T): null | { [P in keyof T]?: string[] | undefined } {
	const res = schema.safeParse(value);
	if (res.success || !value) {
		return null;
	} else {
		return res.error.flatten().fieldErrors as any;
	}
}

export function getTextDirection(lang: string): string {
	const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'dv', 'ha', 'khw', 'ks', 'ku', 'ps', 'syr', 'ug', 'yi']; // Add more RTL languages if needed
	return rtlLanguages.includes(lang) ? 'rtl' : 'ltr';
}

// Motion function
export function motion(start: number, end: number, duration: number, cb: (current: number) => void, useAnimation = true) {
	const frequency = 16;
	const d = (start - end) / (duration / frequency);

	if (d === 0) {
		cb(end);
		return;
	}

	let current = start;

	return new Promise<void>((resolve) => {
		function animation(current: number) {
			current -= d;

			if ((d < 0 && current >= end) || (d > 0 && current <= end)) {
				cb(end);
				resolve();
			} else {
				cb(current);
				requestAnimationFrame(() => animation(current));
			}
		}

		if (useAnimation) {
			requestAnimationFrame(() => animation(current));
		} else {
			const interval = setInterval(async () => {
				current -= d;

				if ((d < 0 && current >= end) || (d > 0 && current <= end)) {
					cb(end);
					clearInterval(interval);
					resolve();
				} else {
					cb(current);
				}
			}, frequency);
		}
	});
}

// Function to calculate Levenshtein distance with fine-tuned parameters
export function getEditDistance(a: string, b: string): number | undefined {
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	const insertionCost = 1; // Adjust the cost of insertion
	const deletionCost = 1; // Adjust the cost of deletion
	const substitutionCost = 1; // Adjust the cost of substitution

	const matrix: number[][] = [];

	// Initialize first row and column
	for (let i = 0; i <= b.length; i++) {
		matrix[i] = [i];
	}
	for (let j = 0; j <= a.length; j++) {
		matrix[0][j] = j;
	}

	// Fill in the rest of the matrix
	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			if (b.charAt(i - 1) === a.charAt(j - 1)) {
				matrix[i][j] = matrix[i - 1][j - 1];
			} else {
				matrix[i][j] = Math.min(
					matrix[i - 1][j - 1] + substitutionCost, // substitution
					Math.min(
						matrix[i][j - 1] + insertionCost, // insertion
						matrix[i - 1][j] + deletionCost
					) // deletion
				);
			}
		}
	}

	// Normalize the distance to make it more intuitive (optional)
	const maxDistance = Math.max(a.length, b.length);
	const normalizedDistance = matrix[b.length][a.length] / maxDistance;

	return normalizedDistance;
}

// checks if the translation progress for a given language exist
export function updateTranslationProgress(data, field) {
	const languages = publicEnv.AVAILABLE_CONTENT_LANGUAGES;
	const $translationProgress = get(translationProgress);
	for (const lang of languages) {
		!$translationProgress[lang] && ($translationProgress[lang] = { total: new Set(), translated: new Set() });
		if (field?.translated) $translationProgress[lang].total.add(field);
		if (field?.translated && data[lang]) $translationProgress[lang].translated.add(field);
		else $translationProgress[lang].translated.delete(field);
	}
	translationProgress.set($translationProgress);
}
