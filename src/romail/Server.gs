package romail

uses gw.util.GosuExceptionUtil

uses javax.mail.Message
uses javax.mail.Session
uses javax.mail.Transport
uses javax.mail.internet.InternetAddress
uses javax.mail.internet.MimeMessage
uses java.util.Properties
uses java.lang.IllegalStateException
uses java.lang.ThreadLocal
uses gw.util.Stack
uses javax.mail.Folder
uses javax.mail.FolderClosedException
uses javax.mail.search.FlagTerm
uses javax.mail.Flags

public class Server implements IReentrant {

  static var _DEFAULT : Server as Base = new Server()
  static var _SERVER_STACK = new ThreadLocal<Stack<Server>>()

  var _sendProtocol : SendProtocol as SendProtocol = SMTPS
  var _fetchProtocol : FetchProtocol as FetchProtocol = IMAPS
  var _sendServer : String as SendServer
  var _fetchServer : String as FetchServer
  var _userName : String as UserName
  var _password : String as Password
  var _defaultSender : String as DefaultSender

  var _tlConnection = new ThreadLocal<PersistentSessionInfo>()
  static class PersistentSessionInfo {
    var _session : Session as Session
    var _transport : Transport as Transport
  }
  
  function sendEmail(email : Email) {
    
    //check to see if another server has been pushed on the thread to use for emailing...
    var serverStack = _SERVER_STACK.get()
    var local = serverStack != null and serverStack.Count > 0 ? serverStack.peek() : null
    if( local != null and local != this ) {
      local.sendEmail( email )
      return
    }
    
    var session = getSession()

    var msg = new MimeMessage(session)
    for (to in email._to) {
      msg.addRecipient(Message.RecipientType.TO, to)
    }

    for (cc in email._cc) {
      msg.addRecipient(Message.RecipientType.CC, cc)
    }

    for (bcc in email._bcc) {
      msg.addRecipient(Message.RecipientType.BCC, bcc)
    }

    msg.Subject = email.Subject

    msg.setText( email.Text )

    if(email._from == null) {
      msg.setFrom( romail.Email.parseEmail(DefaultSender) )
    } else {
      msg.setFrom( email._from )
    }

    msg.saveChanges()

    var tr = getTransport(session)
    
    tr.sendMessage(msg, msg.getAllRecipients())

    tr.close()
  }

  private function getSession() : Session {
    if( _tlConnection.get() != null ) {
      return _tlConnection.get().Session
    }
    return makeSession()
  }
  
  private function makeSession() : Session {
    return Session.getInstance(new Properties(), null)
  }
  
  private function getTransport(session : Session) : Transport {
    if( _tlConnection.get() != null ) {
      return _tlConnection.get().Transport
    }
    return makeTransport(session) 
  }
  
  private function makeTransport(session : Session) : Transport {
    var tr = session.getTransport(_sendProtocol.Val)
    tr.connect(_sendServer, _userName, _password)
    return tr
  }

  function folder(name : String) : EmailFolder {
    return new EmailFolder(this, name)
  }

  property get Inbox() : EmailFolder {
    return folder("INBOX")
  }
  
  override function enter() {
    getStack().push(this)
  }
  
  override function exit() {
    getStack().pop()
  }
  
  internal function getAllMessages( emailFolder : EmailFolder ) : List<Email> {
    var session = getSession()
    // Get the store
    using(var store = session.getStore(_fetchProtocol.Val)) {
      store.connect(FetchServer, UserName, Password)
      // Get folder
      var f = store.getFolder(emailFolder.Name)
      f.open(Folder.READ_ONLY)
      try { 
        return f.Messages.toList().map( \ m -> new Email(m) )
      } finally {
        // Close folder 
        f.close(false)
      }
    }
  }
  
  internal function getUnreadMessages( emailFolder : EmailFolder ) : List<Email> {
    var session = getSession()
    // Get the store
    using(var store = session.getStore(_fetchProtocol.Val)) {
      store.connect(FetchServer, UserName, Password)
      // Get folder
      var f = store.getFolder(emailFolder.Name)
      f.open(Folder.READ_ONLY)
      try { 
        var ft =  new FlagTerm(new Flags(Flags.Flag.SEEN), false)
        return f.search( ft ).toList().map( \ m -> new Email(m) )
      } finally {
        // Close folder 
        f.close(false)
      }
    }
  }
  
  internal function processNewMessages( emailFolder : EmailFolder ) {
    var session = getSession()
    // Get the store
    using(var store = session.getStore(_fetchProtocol.Val)) {
      store.connect(FetchServer, UserName, Password)
      // Get folder
      var f = store.getFolder(emailFolder.Name)
      f.open(Folder.READ_WRITE)
      try { 
        var ft =  new FlagTerm(new Flags(Flags.Flag.SEEN), false)
        for( m in f.search( ft ) ) {
          emailFolder.Listener(new Email(m) )
          m.setFlag( Flags.Flag.SEEN, true )
        }
      } finally {
        // Close folder 
        f.close(false)
      }
    }
  }
  
  function connect() : IReentrant {
    return new IReentrant() {
      override function enter() {
        outer.enter()
        var session = makeSession()
        var tr = makeTransport( session )
        _tlConnection.set( new PersistentSessionInfo() {
          :Session = session,
          :Transport = tr
        })
      }
  
      override function exit() {
        outer.exit()
        _tlConnection.set(null)
      }
    }
  }
  
  private function getStack() : Stack<Server> {
    var stack = _SERVER_STACK.get()
    if( stack == null ) {
      stack = new()
      _SERVER_STACK.set(stack)
    }
    return stack
  }

  public enum FetchProtocol {
    POP("pop3"),
    IMAP("imap"),
    IMAPS("imaps")
    var _code : String as readonly Val
    private construct( c : String) {
      _code = c
    }
  }

  public enum SendProtocol {
    SMTP("smtp"),
    SMTPS("smtps")
    var _code : String as readonly Val
    private construct( c : String) {
      _code = c
    }
  }
}