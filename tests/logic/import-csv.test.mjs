import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const csv = await import(SRC + 'import-csv.js');

// ---------- RFC 4180 parsing ----------
const tricky = 'a,b,c\n1,"two, with comma",3\n4,"say ""hi""",5\n6,"multi\nline",7\n';
const rows = csv.parseCSV(tricky);
check('row count', rows.length === 4, JSON.stringify(rows));
check('embedded comma stays in one field', rows[1][1] === 'two, with comma', rows[1][1]);
check('doubled quotes unescape', rows[2][1] === 'say "hi"', rows[2][1]);
check('embedded newline stays in one field', rows[3][1] === 'multi\nline', JSON.stringify(rows[3][1]));
check('BOM is stripped', csv.parseCSV('\uFEFFa,b\n1,2')[0][0] === 'a');
check('CRLF is handled', csv.parseCSV('a,b\r\n1,2\r\n')[1][1] === '2');
check('blank lines are dropped', csv.parseCSV('a,b\n\n1,2\n').length === 2);

// ---------- Letterboxd ratings.csv ----------
const letterboxd = `Date,Name,Year,Letterboxd URI,Rating
2024-01-04,Dune: Part Two,2024,https://boxd.it/x,4.5
2023-11-02,"Everything Everywhere All at Once",2022,https://boxd.it/y,5
2023-06-01,Tenet,2020,https://boxd.it/z,3`;
const lb = csv.normalizeRows(csv.parseCSV(letterboxd));
check('detects Letterboxd', lb.source === 'Letterboxd', lb.source);
check('detects the 5-star scale', lb.scale === 2, String(lb.scale));
check('4.5 stars becomes 9/10', lb.items[0].rating === 9, String(lb.items[0].rating));
check('5 stars becomes 10/10', lb.items[1].rating === 10);
check('3 stars becomes 6/10', lb.items[2].rating === 6);
check('year parsed', lb.items[0].year === 2024);
check('Letterboxd rows default to movie', lb.items.every(item => item.type === 'movie'));
check('watched date parsed', lb.items[0].watchedAt > 0);

// ---------- IMDb ratings export ----------
const imdb = `Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year
tt1375666,9,2023-04-01,Inception,https://imdb.com/title/tt1375666,movie,8.8,148,2010
tt0903747,10,2022-02-11,Breaking Bad,https://imdb.com/title/tt0903747,tvSeries,9.5,49,2008`;
const im = csv.normalizeRows(csv.parseCSV(imdb));
check('detects IMDb', im.source === 'IMDb', im.source);
check('detects the 10-point scale', im.scale === 1, String(im.scale));
check('IMDb rating passes through', im.items[0].rating === 9);
check('IMDb const becomes imdbId', im.items[0].imdbId === 'tt1375666', im.items[0].imdbId);
check('tvSeries maps to tv', im.items[1].type === 'tv', im.items[1].type);
check('movie maps to movie', im.items[0].type === 'movie');
check('"Date Rated" is used when there is no watched date', im.items[0].watchedAt > 0);

// ---------- Trakt-style export ----------
const trakt = `title,year,type,tmdb_id,imdb_id,rating,watched_at
Arrival,2016,movie,329865,tt2543164,8,2021-05-04T10:00:00Z
Severance,2022,show,95396,tt11280740,9,2023-01-02T10:00:00Z`;
const tk = csv.normalizeRows(csv.parseCSV(trakt));
check('detects a Trakt-shaped export', /Trakt/.test(tk.source), tk.source);
check('tmdb_id captured', tk.items[0].tmdbId === 329865, String(tk.items[0].tmdbId));
check('"show" maps to tv', tk.items[1].type === 'tv', tk.items[1].type);
check('ISO watched_at parsed', tk.items[1].watchedAt > 0);

// ---------- diary de-duplication ----------
const diary = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Watched Date
2024-03-01,Heat,1995,https://boxd.it/a,4,,2024-03-01
2022-08-09,Heat,1995,https://boxd.it/a,5,Yes,2022-08-09
2020-01-01,Heat,1995,https://boxd.it/a,3,Yes,2020-01-01`;
const dr = csv.normalizeRows(csv.parseCSV(diary));
check('rewatches collapse to one row', dr.items.length === 1, String(dr.items.length));
check('keeps the highest rating', dr.items[0].rating === 10, String(dr.items[0].rating));
check('keeps the newest watch date', new Date(dr.items[0].watchedAt).getUTCFullYear() === 2024, new Date(dr.items[0].watchedAt).toISOString());
check('"Watched Date" beats the generic "Date" column', dr.items[0].watchedAt > 0);

// ---------- errors ----------
let threw = '';
try { csv.normalizeRows(csv.parseCSV('foo,bar\n1,2')); } catch (error) { threw = error.message; }
check('a CSV with no usable columns is rejected', /No title, TMDB id, or IMDb id/.test(threw), threw);
threw = '';
try { csv.normalizeRows([['Name', 'Year']]); } catch (error) { threw = error.message; }
check('a header-only file is rejected', /no rows/.test(threw), threw);

// ---------- source detection ----------
check('detectSource: Letterboxd', csv.detectSource(['date', 'name', 'letterboxd uri']) === 'Letterboxd');
check('detectSource: IMDb', csv.detectSource(['const', 'your rating', 'title']) === 'IMDb');
check('detectSource: plain CSV', csv.detectSource(['name', 'year']) === 'CSV');

summary();
