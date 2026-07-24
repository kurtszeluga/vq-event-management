set appDocx to "/Users/kurtszeluga/Documents/GitHub/vq-event-management/exports/VQ_Event_Management_App_Overview.docx"
set roleDocx to "/Users/kurtszeluga/Documents/GitHub/vq-event-management/exports/VQ_Event_Management_Role_Capabilities_Overview.docx"
set appPdf to "/private/tmp/VQ_Event_Management_App_Overview_QA.pdf"
set rolePdf to "/private/tmp/VQ_Event_Management_Role_Capabilities_Overview_QA.pdf"

tell application "Microsoft Word"
	activate
	set appDoc to open file name appDocx
	save as appDoc file name appPdf file format format PDF
	close appDoc saving no
	set roleDoc to open file name roleDocx
	save as roleDoc file name rolePdf file format format PDF
	close roleDoc saving no
end tell
